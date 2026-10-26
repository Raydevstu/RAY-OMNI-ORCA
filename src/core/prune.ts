import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { orchDir } from './paths.js';
import { loadConfig } from './config.js';
import { openStore } from './store.js';

export function prune(root: string) {
  const cfg = loadConfig(root);
  const cutoff = new Date(Date.now() - cfg.retentionDays * 86400_000).toISOString();
  const db = openStore(root);
  const e = db.prepare('DELETE FROM task_events WHERE createdAt < ?').run(cutoff);
  const t = db.prepare('DELETE FROM tasks WHERE createdAt < ?').run(cutoff);
  const v = db.prepare('DELETE FROM verification_runs WHERE createdAt < ?').run(cutoff);
  const c = db.prepare('DELETE FROM confirmations WHERE createdAt < ?').run(cutoff);
  const s = db.prepare("DELETE FROM session_scratchpad WHERE value LIKE '%\"exp\":%'").run();
  // Cap memory as a whole (approved included): oldest first.
  const count = (db.prepare('SELECT COUNT(*) as c FROM memory_items').get() as unknown as { c: number }).c;
  let mem = 0;
  if (count > cfg.maxMemoryItems) {
    const over = count - cfg.maxMemoryItems;
    mem = Number(db.prepare('DELETE FROM memory_items WHERE id IN (SELECT id FROM memory_items ORDER BY created_at ASC LIMIT ?)').run(over).changes);
  }
  let files = 0;
  const dir = join(orchDir(root), 'events');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      try { if (statSync(p).mtime.toISOString() < cutoff) { unlinkSync(p); files++; } } catch { /* ignore */ }
    }
  }
  return { events: e.changes, tasks: t.changes, verifications: v.changes, confirmations: c.changes, scratchpad: s.changes, memory: mem, files };
}
