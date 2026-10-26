import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.js';
import { installCodex } from '../src/adapters/codex.js';
import { installHermes, serverName } from '../src/adapters/hermes.js';
import { paths } from '../src/adapters/shared.js';

test('codex adapter is idempotent and preserves user content', () => {
  const root = fixture(); writeFileSync(join(root, 'AGENTS.md'), '# My rules\nBe nice.\n');
  installCodex(root); installCodex(root);
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('Be nice.')); assert.equal(agents.split('BEGIN ORCH').length, 2);
  const hooks = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.UserPromptSubmit.length, 1);
  assert.ok(readFileSync(join(root, '.codex/config.toml'), 'utf8').includes('[mcp_servers.orch]'));
  assert.ok(existsSync(join(root, '.agents/skills/orch/test-first/SKILL.md')));
});

test('hermes adapter merges into existing config without dropping keys; skips when absent', () => {
  const root = fixture(), home = mkdtempSync(join(tmpdir(), 'hermes-'));
  writeFileSync(join(home, 'config.yaml'), '# keep me\nmodel: foo\nmcp_servers:\n  other:\n    url: https://x\n');
  installHermes(root, { home });
  const y = readFileSync(join(home, 'config.yaml'), 'utf8');
  assert.ok(y.includes('# keep me') && y.includes('other:') && y.includes(serverName(root)) && y.includes('external_dirs'));
  assert.equal(installHermes(root, { home: join(home, 'nope') }), null);
});

test('MCP server end to end: lists tools, compiles tasks, blocks risky actions', async () => {
  const root = fixture();
  const client = new Client({ name: 't', version: '1' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [paths.server], env: { ...process.env, ORCH_ROOT: root } as Record<string, string> }));
  const tools = (await client.listTools()).tools.map(t => t.name);
  for (const n of ['compile_task', 'start_task', 'select_skills', 'request_confirmation', 'decide_confirmation', 'begin_execution', 'apply_edit', 'verify_changes']) assert.ok(tools.includes(n), n);
  const call = async (name: string, args: Record<string, unknown>) =>
    JSON.parse(((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text);
  assert.equal((await call('compile_task', { prompt: 'make it better' })).status, 'needs_clarification');
  const started = await call('start_task', { prompt: 'Add a footer component in src/Footer.tsx that shows the year when rendered' });
  assert.equal(started.started, true); assert.equal(started.checkpoint.ok, true);
  // Gated flow: start identifies gates only; each concrete action needs its own approval + begin_execution.
  const gated = await call('start_task', { prompt: 'drop table users and reset auth tokens, must preserve logins' });
  assert.equal(gated.status, 'needs_approval'); assert.ok(gated.gates.length);
  const action = { file: 'src/auth/login.ts', bytes: 16 };
  const conf = await call('request_confirmation', { taskId: gated.taskId, action });
  assert.ok(conf.fingerprint); assert.equal(conf.status, 'pending');
  const decided = await call('decide_confirmation', { fingerprint: conf.fingerprint, approve: true });
  assert.equal(decided.status, 'approved');
  const begun = await call('begin_execution', { taskId: gated.taskId, action });
  assert.equal(begun.status, 'executing'); assert.equal(begun.checkpoint.ok, true);
  const applied = await call('apply_edit', { taskId: gated.taskId, file: 'src/auth/login.ts', content: '// approved edit' });
  assert.equal(applied.ok, true);
  await client.close();
});
