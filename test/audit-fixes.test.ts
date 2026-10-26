import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { saveTask } from '../src/core/tasks.js';
import { compileTask } from '../src/core/compiler.js';
import { redactDeep } from '../src/core/redact.js';
import { parseSkill } from '../src/core/router.js';
import { Recorder } from '../src/core/recorder.js';
import { readdirSync } from 'node:fs';
import { start_task, decide_confirmation, execute_gated_action } from '../src/mcp/handlers.js';

test('tasks never persist env values or nested secrets', () => {
  const root = fixture({ git: false });
  writeFileSync(join(root, '.env'), 'API_KEY=super-secret-12345\n');
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(join(root, 'apps/web/.env.local'), 'NESTED=nested-secret-999\n');
  const map = { dirs: [], scripts: {} } as never;
  const spec = compileTask('use key super-secret-12345 in Button.tsx should show ok when clicked', map);
  saveTask(root, 'use key super-secret-12345 plus nested-secret-999', spec);
  const raw = readFileSync(join(root, '.orch/orch.db'));
  assert.ok(!raw.includes('super-secret-12345'));
  assert.ok(!raw.includes('nested-secret-999'));
});

test('redactDeep handles PEM, JSON credential, quoted secrets', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
  const out = redactDeep({ k: pem, nested: { token: 'abc' }, arr: [`say "${pem}"`] }, [pem]) as unknown as { k: string };
  assert.ok(!JSON.stringify(out).includes('ABC'));
  assert.equal((out as unknown as { nested: { token: string } }).nested.token, '[REDACTED:field]');
});

test('compiler never returns needs_clarification with []', () => {
  const r = compileTask('make it better when clicked in Button.tsx', { dirs: [], scripts: {} } as never);
  assert.equal(r.status, 'needs_clarification');
  assert.ok(r.questions.length >= 1 && r.questions.length <= 3);
  assert.ok(Array.isArray(r.constraints) && r.constraints.length > 0);
});

test('parseSkill handles yaml colons/quotes/arrays', () => {
  const s = parseSkill('---\nname: x\ndescription: "fix: thing with: colons"\ntriggers:\n  - a\n  - b\n---\nbody', '/tmp');
  assert.deepEqual(s?.triggers, ['a', 'b']);
});

test('gated task cannot execute without approval, then can after approval', async () => {
  const root = fixture({ git: false });
  const r = await start_task(root, { prompt: 'delete all migrations and reset auth tokens in src/auth/login.ts, must preserve logins' }) as { status: string; taskId: string; fingerprint?: string; spec?: unknown };
  assert.equal(r.status, 'needs_approval');
  assert.ok(r.fingerprint);
  await assert.rejects(() => execute_gated_action(root, r.taskId, r.spec ?? {}, async () => {}), /GATED/);
  await decide_confirmation(root, { fingerprint: r.fingerprint!, approve: true });
  const out = await execute_gated_action(root, r.taskId, r.spec ?? {}, async () => 'ok');
  assert.equal(out, 'ok');
});

test('no secret in .orch jsonl output', () => {
  const root = fixture({ git: false });
  writeFileSync(join(root, '.env'), 'API_KEY=topsecret-jsonl-1\n');
  new Recorder(root).record('x', { note: 'leak topsecret-jsonl-1 here' });
  const dir = join(root, '.orch/events');
  const body = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  assert.ok(!body.includes('topsecret-jsonl-1'));
  assert.ok(body.includes('REDACTED'));
});
