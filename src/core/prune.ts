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
  const count = (db.prepare('SELECT COUNT(*) as c FROM memory_items').get() as unknown as { c: number }).c;
  if (count > cfg.maxMemoryItems) {
    db.exec(`DELETE FROM memory_items WHERE id IN (SELECT id FROM memory_items WHERE status='proposed' ORDER BY id ASC LIMIT ${count - cfg.maxMemoryItems})`);
  }
  let files = 0;
  const dir = join(orchDir(root), 'events');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      try { if (statSync(p).mtime.toISOString() < cutoff) { unlinkSync(p); files++; } } catch { /* ignore */ }
    }
  }
  return { events: e.changes, tasks: t.changes, verifications: v.changes, files };
}
