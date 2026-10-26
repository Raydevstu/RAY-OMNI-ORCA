import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Action, installAgentsBlock, installSkills, paths, upsertBlock, writeFile } from './shared.js';

export const TOML_BEGIN = '# BEGIN ORCH', TOML_END = '# END ORCH';
const EVENTS = ['SessionStart', 'UserPromptSubmit'];
const MATCHER: Record<string, string> = { SessionStart: 'startup|resume' };

export function installCodex(root: string, dry = false): Action[] {
  const actions = [installAgentsBlock(root, dry), installSkills(root, dry)];
  const cfg = join(root, '.codex/config.toml');
  const toml = `[mcp_servers.orch]\ncommand = "node"\nargs = [${JSON.stringify(paths.server)}]\nenv = { ORCH_ROOT = ${JSON.stringify(root)} }`;
  writeFile(cfg, upsertBlock(existsSync(cfg) ? readFileSync(cfg, 'utf8') : '', TOML_BEGIN, TOML_END, toml), dry);
  actions.push({ path: cfg, action: 'MCP server (project scope; Codex loads it only after you trust the project)' });

  const hp = join(root, '.codex/hooks.json');
  let json: { hooks?: Record<string, Array<Record<string, unknown>>> } = {};
  if (existsSync(hp)) {
    try { json = JSON.parse(readFileSync(hp, 'utf8')); }
    catch {
      const bak = `${hp}.bak.${Date.now()}`;
      copyFileSync(hp, bak);
      throw new Error(`Invalid JSON in ${hp} (backed up to ${bak}). Fix the file or run orch doctor --fix, then re-run init.`);
    }
  }
  json.hooks ??= {};
  for (const ev of EVENTS) {
    const command = `node --disable-warning=ExperimentalWarning ${JSON.stringify(paths.cli)} hook ${ev} --root ${JSON.stringify(root)}`;
    const list = (json.hooks[ev] ??= []) as { hooks?: { command?: string }[] }[];
    if (!list.some(e => e.hooks?.some(h => h.command?.includes(' hook ' + ev)))) list.push({ ...(MATCHER[ev] ? { matcher: MATCHER[ev] } : {}), hooks: [{ type: 'command', command, timeoutSec: 10 } as never] } as never);
  }
  writeFile(hp, JSON.stringify(json, null, 2), dry);
  actions.push({ path: hp, action: 'event hooks (requires the hooks feature flag in Codex config)' });
  return actions;
}
