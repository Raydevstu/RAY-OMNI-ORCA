import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { ensureDir, orchDir } from './paths.js';
import { envValues, redact } from './redact.js';

export interface MemoryItem { id: number; kind: string; text: string; source: string; status: string; created_at: string }

export class Memory {
  private db: DatabaseSync;
  private secrets: string[];
  constructor(root: string) {
    this.secrets = envValues(root);
    this.db = new DatabaseSync(join(ensureDir(orchDir(root)), 'memory.db'));
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL)`);
  }
  /** New entries start as proposed: nothing becomes a trusted rule until a person approves it. */
  propose(text: string, kind = 'rule', source = 'agent'): number {
    const r = this.db.prepare('INSERT INTO memory_items (kind, text, source, status, created_at) VALUES (?,?,?,?,?)')
      .run(kind, redact(text, this.secrets), source, 'proposed', new Date().toISOString());
    return Number(r.lastInsertRowid);
  }
  setStatus(id: number, status: 'approved' | 'rejected'): void {
    this.db.prepare('UPDATE memory_items SET status = ? WHERE id = ?').run(status, id);
  }
  list(status?: string): MemoryItem[] {
    const rows = status ? this.db.prepare('SELECT * FROM memory_items WHERE status = ? ORDER BY id').all(status)
      : this.db.prepare('SELECT * FROM memory_items ORDER BY id').all();
    return rows as unknown as MemoryItem[];
  }
  /** Keyword-ranked search over approved items, capped by an approximate token budget. */
  search(query: string, tokenBudget = 500): MemoryItem[] {
    const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    const scored = this.list('approved').map(i => ({ i, s: terms.filter(t => i.text.toLowerCase().includes(t)).length }))
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const out: MemoryItem[] = []; let used = 0;
    for (const { i } of scored) { const cost = Math.ceil(i.text.length / 4); if (used + cost > tokenBudget) break; used += cost; out.push(i); }
    return out;
  }
  close(): void { this.db.close(); }
}
