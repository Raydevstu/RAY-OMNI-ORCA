import { createServer, type Server } from 'node:http';
import { openStore } from '../core/store.js';
import { page } from './page.js';

type Row = Record<string, unknown>;
const q = (root: string, sql: string, ...args: unknown[]): Row[] =>
  openStore(root).prepare(sql).all(...(args as never[])) as unknown as Row[];
const day = (iso: string) => String(iso ?? '').slice(0, 10);
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

function gatesOf(row: Row): string[] {
  try {
    const g = JSON.parse(String(row.gates ?? '{}')) as { gates?: string[] };
    return Array.isArray(g.gates) ? g.gates : [];
  } catch { return []; }
}
function goalOf(spec: string): string {
  try {
    const s = JSON.parse(spec) as { goal?: string };
    return String(s.goal ?? '').slice(0, 120);
  } catch { return ''; }
}

export function overview(root: string) {
  const tasksByStatus: Record<string, number> = {};
  for (const r of q(root, 'SELECT status, COUNT(*) as c FROM tasks GROUP BY status')) tasksByStatus[String(r.status)] = num(r.c);
  const confByStatus: Record<string, number> = {};
  for (const r of q(root, 'SELECT status, COUNT(*) as c FROM confirmations GROUP BY status')) confByStatus[String(r.status)] = num(r.c);
  let pass = 0, fail = 0;
  for (const r of q(root, 'SELECT result FROM verification_runs')) {
    try { (JSON.parse(String(r.result)) as { ok?: boolean }).ok ? pass++ : fail++; } catch { fail++; }
  }
  const gateFreq: Record<string, number> = {};
  for (const r of q(root, 'SELECT gates FROM confirmations')) for (const g of gatesOf(r)) gateFreq[g] = (gateFreq[g] ?? 0) + 1;
  const mem = q(root, "SELECT status, COUNT(*) as c FROM memory_items GROUP BY status");
  const memory: Record<string, number> = {};
  for (const r of mem) memory[String(r.status)] = num(r.c);
  const events = q(root, 'SELECT COUNT(*) as c FROM task_events')[0];
  return { tasksByStatus, confByStatus, verifications: { pass, fail }, gateFreq, memory, events: num(events?.c) };
}

export function recentTasks(root: string, limit = 50) {
  return q(root, 'SELECT id,prompt,spec,status,createdAt,execution FROM tasks ORDER BY createdAt DESC LIMIT ?', limit)
    .map(r => ({ id: r.id, prompt: String(r.prompt).slice(0, 140), goal: goalOf(String(r.spec)), status: r.status, createdAt: r.createdAt, bound: !!r.execution }));
}

export function recentConfirmations(root: string, limit = 50) {
  return q(root, 'SELECT fingerprint,taskId,gates,status,createdAt,approvedAt FROM confirmations ORDER BY createdAt DESC LIMIT ?', limit)
    .map(r => ({
      fingerprint: String(r.fingerprint).slice(0, 16), taskId: r.taskId, gates: gatesOf(r),
      status: r.status, createdAt: r.createdAt,
      decisionMs: r.approvedAt ? Date.parse(String(r.approvedAt)) - Date.parse(String(r.createdAt)) : null,
    }));
}

export function recentVerifications(root: string, limit = 20) {
  return q(root, 'SELECT id,taskId,result,createdAt FROM verification_runs ORDER BY createdAt DESC LIMIT ?', limit)
    .map(r => {
      let parsed: { ok?: boolean; checks?: Array<{ name?: string; status?: string }>; findings?: unknown[]; changed?: string[] } = {};
      try { parsed = JSON.parse(String(r.result)); } catch { /* keep empty */ }
      return { id: r.id, taskId: r.taskId, ok: parsed.ok ?? null, checks: parsed.checks ?? [], findings: parsed.findings ?? [], changed: parsed.changed ?? [], createdAt: r.createdAt };
    });
}

export function activity(root: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const ev = new Map<string, number>(), tk = new Map<string, number>(), cf = new Map<string, number>();
  for (const r of q(root, 'SELECT createdAt FROM task_events WHERE createdAt >= ?', since)) ev.set(day(String(r.createdAt)), (ev.get(day(String(r.createdAt))) ?? 0) + 1);
  for (const r of q(root, 'SELECT createdAt FROM tasks WHERE createdAt >= ?', since)) tk.set(day(String(r.createdAt)), (tk.get(day(String(r.createdAt))) ?? 0) + 1);
  for (const r of q(root, 'SELECT createdAt FROM confirmations WHERE createdAt >= ?', since)) cf.set(day(String(r.createdAt)), (cf.get(day(String(r.createdAt))) ?? 0) + 1);
  const out: Array<{ day: string; events: number; tasks: number; confirmations: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    out.push({ day: d, events: ev.get(d) ?? 0, tasks: tk.get(d) ?? 0, confirmations: cf.get(d) ?? 0 });
  }
  return out;
}

function windowStats(root: string, from: string, to: string) {
  const tasks = num(q(root, 'SELECT COUNT(*) as c FROM tasks WHERE createdAt >= ? AND createdAt < ?', from, to)[0]?.c);
  const conf = q(root, 'SELECT status,approvedAt,createdAt FROM confirmations WHERE createdAt >= ? AND createdAt < ?', from, to);
  const decided = conf.filter(r => r.status !== 'pending');
  const approved = conf.filter(r => r.status === 'approved').length;
  const dms = decided
    .filter(r => r.approvedAt)
    .map(r => Date.parse(String(r.approvedAt)) - Date.parse(String(r.createdAt)))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  let pass = 0, total = 0;
  for (const r of q(root, 'SELECT result FROM verification_runs WHERE createdAt >= ? AND createdAt < ?', from, to)) {
    total++;
    try { if ((JSON.parse(String(r.result)) as { ok?: boolean }).ok) pass++; } catch { /* counts as fail */ }
  }
  let gateHits = 0;
  for (const r of q(root, 'SELECT gates FROM confirmations WHERE createdAt >= ? AND createdAt < ?', from, to)) gateHits += gatesOf(r).length;
  return {
    tasks,
    approvalRate: decided.length ? approved / decided.length : null,
    medianDecisionMs: dms.length ? dms[Math.floor(dms.length / 2)] : null,
    verifyPassRate: total ? pass / total : null,
    gateHits,
  };
}

export function benchmark(root: string) {
  const now = Date.now();
  const cur = windowStats(root, new Date(now - 7 * 86400_000).toISOString(), new Date(now).toISOString());
  const prev = windowStats(root, new Date(now - 14 * 86400_000).toISOString(), new Date(now - 7 * 86400_000).toISOString());
  return { current: cur, previous: prev };
}

const routes: Record<string, (root: string, url: URL) => unknown> = {
  '/api/overview': (root) => overview(root),
  '/api/tasks': (root) => recentTasks(root),
  '/api/confirmations': (root) => recentConfirmations(root),
  '/api/verifications': (root) => recentVerifications(root),
  '/api/activity': (root, url) => activity(root, Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 30) || 30))),
  '/api/benchmark': (root) => benchmark(root),
};

export function startDashboard(root: string, port = 7687): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
        return;
      }
      const fn = routes[url.pathname];
      if (req.method === 'GET' && fn) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fn(root, url)));
        return;
      }
      res.writeHead(404).end('not found');
    } catch (e) {
      res.writeHead(500).end(String((e as Error)?.message ?? e));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() });
    });
  });
}
