import { openStore } from './store.js';
import { envValues, redactDeep } from './redact.js';

export interface MemoryItem { id: number; kind: string; text: string; source: string; status: string; created_at: string }

export class Memory {
  private secrets: string[];
  constructor(private root: string) {
    this.secrets = envValues(root);
    openStore(root);
  }
  /** New entries start as proposed: nothing becomes a trusted rule until a person approves it. */
  propose(text: string, kind = 'rule', source = 'agent'): number {
    const safe = redactDeep(text, this.secrets) as string;
    const r = openStore(this.root).prepare(
      'INSERT INTO memory_items (kind, text, source, status, created_at) VALUES (?,?,?,?,?)'
    ).run(kind, safe, source, 'proposed', new Date().toISOString());
    return Number(r.lastInsertRowid);
  }
  setStatus(id: number, status: 'approved' | 'rejected'): void {
    openStore(this.root).prepare('UPDATE memory_items SET status = ? WHERE id = ?').run(status, id);
  }
  list(status?: string): MemoryItem[] {
    const db = openStore(this.root);
    const rows = status ? db.prepare('SELECT * FROM memory_items WHERE status = ? ORDER BY id').all(status)
      : db.prepare('SELECT * FROM memory_items ORDER BY id').all();
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
  close(): void { /* shared store via openStore/closeStore */ }
}
