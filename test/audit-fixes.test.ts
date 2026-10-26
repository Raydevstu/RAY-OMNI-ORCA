import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { saveTask } from '../src/core/tasks.js';
import { compileTask } from '../src/core/compiler.js';
import { redact, redactDeep } from '../src/core/redact.js';
import { changedFiles } from '../src/core/git.js';
import { installCodex } from '../src/adapters/codex.js';
import { parseSkill } from '../src/core/router.js';
import { Recorder } from '../src/core/recorder.js';
import { readdirSync } from 'node:fs';
import { start_task, request_confirmation, decide_confirmation, begin_execution, execute_gated_action } from '../src/mcp/handlers.js';
import { createPending } from '../src/core/confirmations.js';

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

test('gated flow: plan approval does not approve actions; begin_execution creates the checkpoint', async () => {
  const root = fixture();
  const r = await start_task(root, { prompt: 'delete all migrations and reset auth tokens in src/auth/login.ts, must preserve logins' }) as { status: string; taskId: string };
  assert.equal(r.status, 'needs_approval');
  // Plan-level approval must NOT unlock action execution.
  const action = { file: 'src/auth/login.ts', bytes: 10 };
  await assert.rejects(() => execute_gated_action(root, r.taskId, action, async () => {}), /GATED/);
  await assert.rejects(() => begin_execution(root, { taskId: r.taskId, action }), /GATED/);
  // Per-action approval, then begin_execution creates rollback protection.
  const conf = await request_confirmation(root, { taskId: r.taskId, action });
  await decide_confirmation(root, { fingerprint: conf.fingerprint, approve: true });
  const begun = await begin_execution(root, { taskId: r.taskId, action });
  assert.equal(begun.status, 'executing'); assert.equal(begun.checkpoint.ok, true);
  const out = await execute_gated_action(root, r.taskId, action, async () => 'ok');
  assert.equal(out, 'ok');
});

test('denied confirmation stays denied (no silent re-pending)', async () => {
  const root = fixture({ git: false });
  const r = await start_task(root, { prompt: 'drop table users, must preserve logins for admins' }) as { status: string; taskId: string };
  const action = { file: 'migrations/001.sql', bytes: 5 };
  const conf = await request_confirmation(root, { taskId: r.taskId, action });
  await decide_confirmation(root, { fingerprint: conf.fingerprint, approve: false });
  assert.throws(() => createPending(root, r.taskId, action, ['migration'], 'action'), /denied/);
  await assert.rejects(() => execute_gated_action(root, r.taskId, action, async () => {}), /GATED/);
});

test('caller-supplied gates cannot suppress detected gates', async () => {
  const root = fixture({ git: false });
  const r = await start_task(root, { prompt: 'Add a footer component in src/Footer.tsx that shows the year when rendered' }) as { status: string; taskId: string };
  const conf = await request_confirmation(root, { taskId: r.taskId, action: 'drop table users', gates: ['docs'] });
  assert.ok(conf.gates.includes('delete'));
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

test('DATABASE_URL, postgres URLs, cookies and opaque session values are redacted', () => {
  const url = 'postgres://admin:s3cret-pw@db.internal:5432/app';
  const r = redact(`Set DATABASE_URL=${url} and Cookie: session=opaque-abcdef-123456`, []);
  assert.ok(!r.includes('s3cret-pw') && !r.includes(url), r);
  assert.ok(!r.includes('opaque-abcdef-123456'), r);
  // Sensitive-key objects are replaced wholesale, not traversed.
  const deep = redactDeep({ authorization: { value: 'custom-session-identifier-xyz' }, ok: 1 }, []) as Record<string, unknown>;
  assert.equal(deep.authorization, '[REDACTED:field]');
  assert.ok(!JSON.stringify(deep).includes('custom-session-identifier-xyz'));
});

test('default verification makes no network calls (local-first)', async () => {
  const { verify } = await import('../src/core/verifier.js');
  const root = fixture({ scripts: {} });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: {}, dependencies: { 'totally-made-up-pkg-xyz': '^1.0.0' } }));
  const { indexProject } = await import('../src/core/indexer.js');
  const map = indexProject(root);
  let fetched = false;
  const fake = (async () => { fetched = true; return { status: 404, ok: false }; }) as unknown as typeof fetch;
  const rep = await verify(root, map, { fetchFn: fake });
  assert.equal(fetched, false);
  assert.ok(rep.findings.some(f => f.detail.includes('network-audit-disabled')));
});

test('excluded paths are ignored by the verifier', async () => {
  const { verify } = await import('../src/core/verifier.js');
  const { indexProject } = await import('../src/core/indexer.js');
  const root = fixture({ scripts: {} });
  const map = indexProject(root);
  mkdirSync(join(root, 'secrets'), { recursive: true });
  writeFileSync(join(root, 'secrets/leak.ts'), 'const password = "hunter2hunter2";\n');
  const rep = await verify(root, map, { network: false });
  assert.ok(!rep.findings.some(f => f.detail.includes('secrets/leak.ts')));
});

test('git status parsing handles spaces in filenames', () => {
  const root = fixture();
  writeFileSync(join(root, 'src/my file.ts'), 'export const x = 1;\n');
  const { changed } = changedFiles(root);
  assert.ok(changed.includes('src/my file.ts'), JSON.stringify(changed));
});

test('existing custom skill files survive orch init', () => {
  const root = fixture({ git: false });
  const custom = join(root, '.agents/skills/orch/secure-coding/SKILL.md');
  mkdirSync(join(root, '.agents/skills/orch/secure-coding'), { recursive: true });
  writeFileSync(custom, '# MINE - do not overwrite\n');
  installCodex(root, false);
  assert.equal(readFileSync(custom, 'utf8'), '# MINE - do not overwrite\n');
  assert.ok(existsSync(join(root, '.agents/skills/orch/test-first/SKILL.md')));
});

test('codex init backs up malformed hooks.json instead of crashing silently', () => {
  const root = fixture({ git: false });
  mkdirSync(join(root, '.codex'), { recursive: true });
  writeFileSync(join(root, '.codex/hooks.json'), '{ not json');
  assert.throws(() => installCodex(root, false), /backed up/);
  assert.ok(existsSync(join(root, '.codex/hooks.json')));
});
