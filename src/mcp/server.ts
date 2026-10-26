import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { bundledSkills, rootFromEnv } from '../core/paths.js';
import { indexProject, loadProjectMap } from '../core/indexer.js';
import { compileTask } from '../core/compiler.js';
import { loadSkills, selectSkills } from '../core/router.js';
import { classify } from '../core/gates.js';
import { Recorder } from '../core/recorder.js';
import { Memory } from '../core/memory.js';
import { explainChanges, verify } from '../core/verifier.js';
import { createCheckpoint, rollback } from '../core/checkpoint.js';
import { loadTasks, saveTask } from '../core/tasks.js';


export function buildServer(root: string): McpServer {
  const server = new McpServer({ name: 'orch', version: '0.1.0' });
  const rec = new Recorder(root);
  const reply = (tool: string, args: unknown, result: unknown) => {
    rec.record('tool', { tool, args });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  };
  const skills = () => loadSkills([join(root, '.agents/skills'), bundledSkills]);

  server.registerTool('get_project_context', { description: 'Project map (stack, scripts, folders) and approved memory relevant to a query.',
    inputSchema: { query: z.string().optional() } }, async ({ query }) => {
      const map = indexProject(root); const mem = new Memory(root);
      const memory = query ? mem.search(query) : []; mem.close();
      return reply('get_project_context', { query }, { map, memory });
    });

  server.registerTool('compile_task', { description: 'Turn a raw request into a concrete spec, or return clarifying questions. Call before starting non-trivial work.',
    inputSchema: { prompt: z.string() } }, async ({ prompt }) =>
      reply('compile_task', { prompt }, compileTask(prompt, loadProjectMap(root))));

  server.registerTool('start_task', { description: 'Register a compiled task and create a rollback checkpoint.',
    inputSchema: { prompt: z.string() } }, async ({ prompt }) => {
      const spec = compileTask(prompt, loadProjectMap(root));
      if (spec.status === 'needs_clarification') return reply('start_task', { prompt }, { started: false, questions: spec.questions });
      const task = saveTask(root, prompt, spec);
      return reply('start_task', { prompt }, { started: true, task, checkpoint: createCheckpoint(root, task.id) });
    });

  server.registerTool('select_skills', { description: 'Pick up to 3 relevant skills for a task, with reasons. Returns only the selected skills.',
    inputSchema: { text: z.string() } }, async ({ text }) => {
      const all = skills(); const picked = selectSkills(text, all);
      return reply('select_skills', { text }, picked.map(p => ({ ...p, instructions: all.find(s => s.name === p.name)?.body.trim() })));
    });

  server.registerTool('request_confirmation', { description: 'Check whether an action needs the user to confirm. If so, STOP and ask the user before continuing.',
    inputSchema: { action: z.string(), paths: z.array(z.string()).optional() } }, async ({ action, paths }) => {
      const g = classify({ text: action, paths });
      return reply('request_confirmation', { action, paths }, { requiresUserConfirmation: g.confirm, reasons: g.reasons,
        instruction: g.confirm ? 'Ask the user for explicit approval before doing this. Do not proceed on your own.' : 'No confirmation needed.' });
    });

  server.registerTool('verify_changes', { description: 'Run project checks, secret scan and dependency check on the current changes.',
    inputSchema: { network: z.boolean().optional() } }, async ({ network }) => {
      const report = await verify(root, loadProjectMap(root), { network });
      rec.record('verify', { ok: report.ok, checks: report.checks.map(c => `${c.name}:${c.status}`), findings: report.findings.length });
      return reply('verify_changes', { network }, report);
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
