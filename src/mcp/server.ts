import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { bundledSkills, rootFromEnv } from '../core/paths.js';
import { indexProject, loadProjectMap } from '../core/indexer.js';
import { compileTask } from '../core/compiler.js';
import { loadSkills, selectSkills } from '../core/router.js';
import { Recorder } from '../core/recorder.js';
import { Memory } from '../core/memory.js';
import { explainChanges, verify } from '../core/verifier.js';
import { createCheckpoint, rollback } from '../core/checkpoint.js';
import { loadTasks, getTask } from '../core/tasks.js';
import { start_task, request_confirmation, decide_confirmation, begin_execution } from './handlers.js';
import { getConfirmation } from '../core/confirmations.js';
import { classify } from '../core/gates.js';
import { changedFiles } from '../core/git.js';
import { shouldProcessPath } from '../core/config.js';


export function buildServer(root: string): McpServer {
  const server = new McpServer({ name: 'orch', version: '0.1.0' });
  const rec = new Recorder(root);
  const reply = (tool: string, args: unknown, result: unknown) => {
    rec.record('tool', { tool, args });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  };
  const skills = () => loadSkills([join(root, '.agents/skills'), join(root, '.agents/skills/orch'), bundledSkills]);

  server.registerTool('get_project_context', { description: 'Project map (stack, scripts, folders) and approved memory relevant to a query.',
    inputSchema: { query: z.string().optional() } }, async ({ query }) => {
      const map = indexProject(root); const mem = new Memory(root);
      const memory = query ? mem.search(query) : []; mem.close();
      return reply('get_project_context', { query }, { map, memory });
    });

  server.registerTool('compile_task', { description: 'Turn a raw request into a concrete spec, or return clarifying questions. Call before starting non-trivial work.',
    inputSchema: { prompt: z.string() } }, async ({ prompt }) =>
      reply('compile_task', { prompt }, compileTask(prompt, loadProjectMap(root))));

  server.registerTool('start_task', { description: 'Compile prompt, detect gates, create pending approval if needed. Returns needs_clarification, needs_approval, or executable.',
    inputSchema: { prompt: z.string() } }, async ({ prompt }) => {
      const out = await start_task(root, { prompt });
      if (out.status === 'executable') {
        const task = getTask(root, out.taskId);
        if (task) return reply('start_task', { prompt }, { started: true, task, checkpoint: createCheckpoint(root, task.id) });
      }
      return reply('start_task', { prompt }, out);
    });

  server.registerTool('select_skills', { description: 'Pick up to 3 relevant skills for a task, with reasons. Returns only the selected skills.',
    inputSchema: { text: z.string() } }, async ({ text }) => {
      const all = skills(); const picked = selectSkills(text, all);
      return reply('select_skills', { text }, picked.map(p => ({ ...p, instructions: all.find(s => s.name === p.name)?.body.trim() })));
    });

  server.registerTool('request_confirmation', { description: 'Create a pending confirmation for a gated action. STOP and wait for decide_confirmation approval.',
    inputSchema: { taskId: z.string(), action: z.unknown(), gates: z.array(z.string()).optional() } }, async ({ taskId, action, gates }) => {
      const out = await request_confirmation(root, { taskId, action, gates: gates as string[] | undefined });
      return reply('request_confirmation', { taskId }, { ...out, requiresUserConfirmation: true,
        instruction: 'Show the fingerprint to the user and call decide_confirmation with approve=true. Do not proceed on your own.' });
    });

  server.registerTool('decide_confirmation', { description: 'Approve or deny a confirmation fingerprint.',
    inputSchema: { fingerprint: z.string(), approve: z.boolean() } }, async ({ fingerprint, approve }) => {
      const out = await decide_confirmation(root, { fingerprint, approve });
      return reply('decide_confirmation', { fingerprint }, out);
    });

  server.registerTool('begin_execution', { description: 'Verify approval for a concrete action, create a rollback checkpoint, mark executing. Action must exactly match the approved request_confirmation action (for edits: {file, bytes}).',
    inputSchema: { taskId: z.string(), action: z.unknown() } }, async ({ taskId, action }) => {
      const out = await begin_execution(root, { taskId, action });
      return reply('begin_execution', { taskId }, out);
    });

  server.registerTool('apply_edit', { description: 'Write a file through the gate. For gated paths, request_confirmation must have approved action {file, bytes} with the same byte length.',
    inputSchema: { taskId: z.string(), file: z.string(), content: z.string() } }, async ({ taskId, file, content }) => {
      const { resolve, join, relative, sep } = await import('node:path');
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { requireApproval } = await import('../core/confirmations.js');
      const abs = resolve(root, file);
      const rel = relative(root, abs);
      if (rel.startsWith('..') || abs === root) return reply('apply_edit', { taskId, file }, { ok: false, note: 'Path escapes project root.' });
      const norm = rel.split(sep).join('/');
      if (!shouldProcessPath(root, norm)) return reply('apply_edit', { taskId, file }, { ok: false, note: `Path is excluded by config: ${norm}` });
      const seen = new Map<string, string>();
      for (const r of classify({ text: `${norm}\n${content.slice(0, 2000)}`, paths: [norm] }).reasons) seen.set(r.gate, r.why);
      const gates = [...seen].map(([gate, why]) => ({ gate, why }));
      const action = { file: norm, bytes: content.length };
      if (gates.length) {
        try { requireApproval(root, taskId, action, 'action'); }
        catch { return reply('apply_edit', { taskId, file }, { ok: false, gate_hit: true, gates: gates.map(g => g.gate), note: 'Gated path without approval. Call request_confirmation then begin_execution first.' }); }
      }
      mkdirSync(join(root, norm.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(abs, content);
      new Recorder(root).record('edit_applied', { taskId, file: norm, gates: gates.map(g => g.gate) });
      return reply('apply_edit', { taskId, file }, { ok: true, file: norm });
    });

  server.registerTool('verify_changes', { description: 'Run project checks, secret scan and dependency check on the current changes. Fail-closed: gated files changed without an approved action are reported.',
    inputSchema: { network: z.boolean().optional(), taskId: z.string().optional() } }, async ({ network, taskId }) => {
      const report = await verify(root, loadProjectMap(root), { network });
      if (taskId) {
        const { openStore } = await import('../core/store.js');
        const changed = changedFiles(root).changed.filter(f => shouldProcessPath(root, f));
        const unapproved: string[] = [];
        for (const f of changed) {
          if (!classify({ paths: [f] }).reasons.length) continue;
          try {
            const rows = openStore(root).prepare("SELECT gates FROM confirmations WHERE taskId=? AND status='approved'").all(taskId) as unknown as Array<{ gates: string }>;
            const covered = rows.some(r => { try { const g = JSON.parse(r.gates); return g?.action?.file === f; } catch { return false; } });
            if (!covered) unapproved.push(f);
          } catch { unapproved.push(f); }
        }
        if (unapproved.length) {
          report.ok = false;
          report.findings.push({ severity: 'high', kind: 'gate', detail: `Gated files changed without an approved action: ${unapproved.join(', ')}. Rollback recommended.` });
        }
      }
      rec.record('verify', { ok: report.ok, checks: report.checks.map(c => `${c.name}:${c.status}`), findings: report.findings.length });
      return reply('verify_changes', { network, taskId }, report);
    });

  server.registerTool('explain_changes', { description: 'Plain-language summary of what changed and what needs review.', inputSchema: {} },
    async () => reply('explain_changes', {}, { summary: explainChanges(root) }));

  server.registerTool('search_memory', { description: 'Search approved project memory.', inputSchema: { query: z.string() } }, async ({ query }) => {
    const m = new Memory(root); const r = m.search(query); m.close(); return reply('search_memory', { query }, r);
  });
  server.registerTool('propose_memory', { description: 'Propose a rule or fact. It is NOT trusted until the user approves it.',
    inputSchema: { text: z.string(), kind: z.enum(['rule', 'fact', 'decision']).optional() } }, async ({ text, kind }) => {
      const m = new Memory(root); const id = m.propose(text, kind ?? 'rule', 'agent'); m.close();
      return reply('propose_memory', { kind }, { id, status: 'proposed' });
    });
  server.registerTool('record_event', { description: 'Append a redacted event to the project log.',
    inputSchema: { type: z.string(), data: z.record(z.string(), z.unknown()).optional() } }, async ({ type, data }) => {
      rec.record(`agent:${type}`, data ?? {}); return reply('record_event', { type }, { recorded: true });
    });
  server.registerTool('rollback_task', { description: 'Restore tracked files to the task checkpoint. Confirm with the user first.',
    inputSchema: { taskId: z.string() } }, async ({ taskId }) => {
      const known = loadTasks(root).some(t => t.id === taskId);
      return reply('rollback_task', { taskId }, known ? rollback(root, taskId) : { ok: false, note: 'Unknown task id.' });
    });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildServer(rootFromEnv()).connect(new StdioServerTransport());
}
