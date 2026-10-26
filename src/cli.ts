#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { indexProject } from './core/indexer.js';
import { Recorder } from './core/recorder.js';
import { Memory } from './core/memory.js';
import { loadTasks } from './core/tasks.js';
import { orchDir } from './core/paths.js';
import { loadConfig, ConfigSchema, configPath } from './core/config.js';
import { prune } from './core/prune.js';
import { installCodex, TOML_BEGIN } from './adapters/codex.js';
import { hermesHome, hermesPresent, installHermes, serverName } from './adapters/hermes.js';
import { AGENTS_BEGIN } from './adapters/shared.js';
import { buildServer } from './mcp/server.js';
import { buildInjection, sessionContext } from './core/context.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[i + 1]) : undefined; };
const root = resolve(flag('root') ?? process.cwd());
const ok = (b: boolean) => (b ? 'ok  ' : 'FAIL');

async function main(): Promise<void> {
  switch (cmd) {
    case 'init': {
      const dry = flag('dry-run') === 'true', platform = flag('platform') ?? 'all';
      const map = dry ? null : indexProject(root);
      if (map) {
        console.log(`Indexed ${map.name} (${map.packageManager}; ${map.frameworks.join(', ') || 'no framework detected'})`);
        if (map.isGit) { const gi = join(root, '.gitignore'); const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
          if (!/^\.orch\/?$/m.test(cur)) appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}.orch/\n`); }
      }
      if (platform === 'all' || platform === 'codex') for (const a of installCodex(root, dry)) console.log(`${dry ? '[dry-run] ' : ''}codex  ${a.action}: ${a.path}`);
      if (platform === 'all' || platform === 'hermes') {
        const a = installHermes(root, { dry, home: flag('hermes-home'), force: platform === 'hermes' });
        if (!a) console.log('hermes not detected; skipped (use --platform hermes to force)');
        else for (const x of a) console.log(`${dry ? '[dry-run] ' : ''}hermes ${x.action}: ${x.path}`);
      }
      console.log('\nNext: trust this project in Codex, and enable the hooks feature flag in your Codex config (its name differs between Codex versions). Then run: orch doctor');
      break;
    }
    case 'doctor': {
      const checks: [boolean, string][] = [];
      const read = (p: string) => existsSync(p) ? readFileSync(p, 'utf8') : '';
      checks.push([Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node} (needs 22.5 or newer)`]);
      checks.push([existsSync(join(orchDir(root), 'project-map.json')), 'project indexed (.orch/project-map.json)']);
      checks.push([existsSync(join(root, '.git')), 'git repository (needed for checkpoints)']);
      checks.push([read(join(root, 'AGENTS.md')).includes(AGENTS_BEGIN), 'AGENTS.md contains orch rules']);
      checks.push([existsSync(join(root, '.agents/skills/orch/secure-coding/SKILL.md')), 'skills installed in .agents/skills/orch']);
      checks.push([read(join(root, '.codex/config.toml')).includes(TOML_BEGIN), 'Codex MCP config written']);
      checks.push([read(join(root, '.codex/hooks.json')).includes(' hook '), 'Codex hooks written']);
      const hh = hermesHome(flag('hermes-home'));
      if (hermesPresent(hh)) checks.push([read(join(hh, 'config.yaml')).includes(serverName(root)), 'Hermes MCP entry present']);
      const events = new Recorder(root).recent(200);
      const flagOn = [join(root, '.codex/config.toml'), join(homedir(), '.codex/config.toml')].some(p => /^\s*(codex_hooks|hooks)\s*=\s*true/m.test(read(p)));
      checks.push([flagOn, 'Codex hooks feature flag enabled (codex_hooks or hooks = true under [features])']);
      checks.push([events.some(e => e.type === 'hook'), 'hook events have been received (if not, hooks may be disabled)']);
      checks.push([events.some(e => e.type === 'inject'), 'context has been injected into a prompt']);
      checks.push([events.some(e => e.type === 'tool'), 'MCP tools have been called by an agent']);
      for (const [pass, label] of checks) console.log(`${ok(pass)}  ${label}`);
      process.exitCode = checks.slice(0, 7).every(c => c[0]) ? 0 : 1;
      break;
    }
    case 'status': {
      const m = existsSync(join(orchDir(root), 'orch.db')) || existsSync(join(orchDir(root), 'memory.db')) ? new Memory(root) : null;
      console.log(`tasks: ${loadTasks(root).length}`);
      console.log(`memory: ${m?.list('approved').length ?? 0} approved, ${m?.list('proposed').length ?? 0} awaiting review`);
      const dir = join(orchDir(root), 'events');
      console.log(`event files: ${existsSync(dir) ? readdirSync(dir).length : 0}`);
      for (const e of new Recorder(root).recent(5)) console.log(`  ${e.ts} ${e.type}`);
      m?.close();
      break;
    }
    case 'memory': {
      const m = new Memory(root); const [sub, id] = argv.slice(1);
      if (sub === 'approve' || sub === 'reject') m.setStatus(Number(id), sub === 'approve' ? 'approved' : 'rejected');
      else for (const i of m.list('proposed')) console.log(`#${i.id} [${i.kind}] ${i.text}`);
      m.close(); break;
    }
    case 'hook': {
      let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
      let payload: Record<string, unknown> = {}; try { payload = JSON.parse(raw); } catch { /* not JSON */ }
      const rec = new Recorder(root); const ev = argv[1] ?? '';
      rec.record('hook', { event: ev, payload: Object.keys(payload).length ? payload : raw.slice(0, 4000) });
      try { // a hook must never break the user's prompt: any failure means "add nothing"
        let ctx: string | null = null;
        if (ev === 'UserPromptSubmit' && typeof payload.prompt === 'string') {
          const inj = buildInjection(root, payload.prompt);
          if (inj) { ctx = inj.text; rec.record('inject', { kind: inj.kind, skills: inj.skills, approxTokens: inj.approxTokens }); }
        } else if (ev === 'SessionStart') ctx = sessionContext(root);
        if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: ctx } }));
      } catch (e) { rec.record('hook_error', { event: ev, message: String((e as Error)?.message ?? e) }); }
      break;
    }
    case 'mcp': {
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      await buildServer(root).connect(new StdioServerTransport()); break;
    }
    case 'config': {
      const sub = argv[1];
      if (sub === 'show') console.log(JSON.stringify(loadConfig(root), null, 2));
      else if (sub === 'validate') { ConfigSchema.parse(JSON.parse(readFileSync(configPath(root), 'utf8'))); console.log('config valid'); }
      else console.log('orch config <show|validate> [--root DIR]');
      break;
    }
    case 'prune': {
      console.log(JSON.stringify(prune(root)));
      break;
    }
    default:
      console.log('orch <init|doctor|status|memory|mcp|config|prune> [--root DIR] [--platform codex|hermes|all] [--dry-run] [--hermes-home DIR]');
  }
}
main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
