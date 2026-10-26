import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.js';
import { redact, detectSecrets } from '../src/core/redact.js';
import { indexProject } from '../src/core/indexer.js';
import { compileTask } from '../src/core/compiler.js';
import { classify } from '../src/core/gates.js';
import { loadSkills, selectSkills } from '../src/core/router.js';
import { Recorder } from '../src/core/recorder.js';
import { Memory } from '../src/core/memory.js';
import { verify, checkRegistry } from '../src/core/verifier.js';
import { createCheckpoint, rollback } from '../src/core/checkpoint.js';
import { bundledSkills } from '../src/core/paths.js';

test('redact removes known secret shapes and env values', () => {
  const t = 'key sk-abcdefghijklmnopqrstuvwx and password: hunter2hunter2 and AKIAABCDEFGHIJKLMNOP and mydbpass99';
  const r = redact(t, ['mydbpass99']);
  for (const s of ['sk-abcdef', 'hunter2hunter2', 'AKIAABCD', 'mydbpass99']) assert.ok(!r.includes(s), s);
  assert.deepEqual(detectSecrets('ok text'), []);
});

test('indexer detects stack and writes project map', () => {
  const root = fixture(); const m = indexProject(root);
  assert.equal(m.packageManager, 'npm'); assert.ok(m.frameworks.includes('React')); assert.ok(m.dirs.includes('src'));
  assert.ok(existsSync(join(root, '.orch/PROJECT.md')));
});

test('compiler asks questions for vague prompts and compiles concrete ones', () => {
  const m = indexProject(fixture());
  const vague = compileTask('make it better', m);
  assert.equal(vague.status, 'needs_clarification'); assert.ok(vague.questions.length >= 1);
  const ok = compileTask('Add a contact form to src/pages/contact.tsx that validates the email and shows an error when invalid', m);
  assert.equal(ok.status, 'ready'); assert.ok(ok.acceptance.some(a => a.includes('test')));
});

test('gates flag risky text and paths', () => {
  assert.ok(classify({ text: 'run a database migration' }).confirm);
  assert.ok(classify({ paths: ['.env.production', 'package.json'] }).reasons.length >= 2);
  assert.ok(classify({ deletedPaths: ['src/a.ts'] }).confirm);
  assert.equal(classify({ paths: ['src/components/Button.tsx'], text: 'tweak button padding' }).confirm, false);
});

test('router selects relevant bundled skills with reasons and a cap', () => {
  const skills = loadSkills([bundledSkills]); assert.equal(skills.length, 3);
  const pick = selectSkills('fix the login bug and add form validation tests', skills);
  assert.ok(pick.length >= 1 && pick.length <= 3); assert.equal(pick[0].name, 'secure-coding');
  assert.deepEqual(selectSkills('adjust button color', skills), []);
});

test('recorder never writes secrets to disk', () => {
  const root = fixture({ git: false }); writeFileSync(join(root, '.env'), 'DB_PASSWORD=supersecretvalue1\n');
  const r = new Recorder(root); r.record('x', { note: 'connect with supersecretvalue1 and sk-abcdefghijklmnopqrstuvwx' });
  const dir = join(root, '.orch/events'); const body = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  assert.ok(!body.includes('supersecretvalue1') && !body.includes('sk-abcdef')); assert.ok(body.includes('REDACTED'));
});

test('memory: proposals are untrusted until approved', () => {
  const m = new Memory(fixture({ git: false })); const id = m.propose('Always use pnpm for installs');
  assert.deepEqual(m.search('pnpm installs'), []);
  m.setStatus(id, 'approved'); assert.equal(m.search('pnpm installs').length, 1); m.close();
});

test('verifier: catches secrets in changes, runs checks, flags missing packages', async () => {
  const root = fixture({ scripts: { test: 'node -e "process.exit(1)"' } }); const map = indexProject(root);
  writeFileSync(join(root, 'src/leak.ts'), 'const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  const rep = await verify(root, map, { network: false });
  assert.equal(rep.ok, false);
  assert.ok(rep.findings.some(f => f.kind === 'secret' && f.detail.includes('leak.ts')));
  assert.equal(rep.checks.find(c => c.name === 'test')?.status, 'failed');
  const fake = (async () => ({ status: 404, ok: false })) as unknown as typeof fetch;
  assert.ok((await checkRegistry(['totally-made-up-pkg'], fake))[0].detail.includes('not found'));
});

test('checkpoint and rollback restore tracked files', () => {
  const root = fixture(); const f = join(root, 'src/app.ts');
  writeFileSync(f, 'export const a = 2;\n'); assert.ok(createCheckpoint(root, 't1').ok);
  writeFileSync(f, 'broken'); assert.ok(rollback(root, 't1').ok);
  assert.equal(readFileSync(f, 'utf8'), 'export const a = 2;\n');
});
