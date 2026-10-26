import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { start_task, request_confirmation, decide_confirmation } from '../src/mcp/handlers.js';
import { openStore } from '../src/core/store.js';
import { startDashboard } from '../src/dashboard/server.js';

async function seed(root: string) {
  const r = await start_task(root, { prompt: 'Reset auth tokens in src/auth/login.ts, must preserve logins' }) as { taskId: string };
  const conf = await request_confirmation(root, { taskId: r.taskId, action: { file: 'src/auth/login.ts', content: 'export const a = 1;' } });
  await decide_confirmation(root, { fingerprint: conf.fingerprint, approve: true });
  openStore(root).prepare('INSERT INTO verification_runs(id,taskId,result,createdAt) VALUES(?,?,?,?)')
    .run('vr1', r.taskId, JSON.stringify({ ok: true, checks: [{ name: 'test', status: 'passed' }], findings: [], changed: ['src/auth/login.ts'] }), new Date().toISOString());
  return r.taskId;
}

test('dashboard serves overview, lists and benchmark', async () => {
  const root = fixture({ git: false });
  await seed(root);
  const { url, close } = await startDashboard(root, 0);
  try {
    const get = async (p: string) => (await fetch(new URL(p, url))).json() as Promise<Record<string, unknown>>;
    const ov = await get('/api/overview');
    assert.deepEqual(ov.tasksByStatus, { needs_approval: 1 });
    assert.deepEqual(ov.confByStatus, { approved: 1 });
    assert.deepEqual(ov.verifications, { pass: 1, fail: 0 });
    assert.ok((ov.gateFreq as Record<string, number>).auth >= 1);
    const tasks = await get('/api/tasks') as unknown as Array<{ bound: boolean }>;
    assert.equal(tasks.length, 1);
    const confs = await get('/api/confirmations') as unknown as Array<{ decisionMs: number | null }>;
    assert.equal(confs.length, 1);
    assert.ok(typeof confs[0].decisionMs === 'number');
    const vers = await get('/api/verifications') as unknown as Array<{ ok: boolean }>;
    assert.equal(vers.length, 1);
    assert.equal(vers[0].ok, true);
    const act = await get('/api/activity?days=7') as unknown as Array<{ day: string }>;
    assert.equal(act.length, 7);
    const bench = await get('/api/benchmark') as unknown as { current: { tasks: number } };
    assert.equal(bench.current.tasks, 1);
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('orch dashboard') && html.includes('Benchmarks'));
  } finally {
    close();
  }
});
