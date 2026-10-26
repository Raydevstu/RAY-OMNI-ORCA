import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, orchDir } from './paths.js';
import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { envValues, redactDeep } from './redact.js';

export interface OrchEvent { ts: string; type: string; data: unknown }

export class Recorder {
  private secrets: string[];
  constructor(private root: string) { this.secrets = envValues(root); }
  private dir() { return ensureDir(join(orchDir(this.root), 'events')); }

  record(type: string, data: unknown = {}): OrchEvent {
    const ev: OrchEvent = { ts: new Date().toISOString(), type, data };
    const safe = redactDeep(ev, this.secrets) as OrchEvent;
    const line = JSON.stringify(safe);
    try {
      openStore(this.root).prepare(
        'INSERT INTO task_events(taskId,type,data,createdAt) VALUES(?,?,?,?)'
      ).run(((data as Record<string, unknown> | null | undefined)?.taskId as string | null) ?? null, type, JSON.stringify(safe.data), safe.ts);
    } catch { /* store unavailable: jsonl still written */ }
    try {
      const cfg = loadConfig(this.root);
      const f = join(this.dir(), `${safe.ts.slice(0, 10)}.jsonl`);
      try {
        if (existsSync(f) && statSync(f).size > cfg.maxEventFileBytes) return safe;
      } catch { /* ignore */ }
      appendFileSync(f, line + '\n');
    } catch { /* ignore */ }
    return safe;
  }

  recent(n = 20): OrchEvent[] {
    try {
      const rows = openStore(this.root).prepare(
        'SELECT type,data,createdAt as ts FROM task_events ORDER BY id DESC LIMIT ?'
      ).all(n) as unknown as Array<{ type: string; data: string; ts: string }>;
      if (rows.length) return rows.map(r => ({ ts: r.ts, type: r.type, data: JSON.parse(r.data) })).reverse();
    } catch { /* fall back to jsonl */ }
    const dir = join(orchDir(this.root), 'events');
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse();
    const out: OrchEvent[] = [];
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).reverse();
      for (const l of lines) { out.push(JSON.parse(l)); if (out.length >= n) return out; }
    }
    return out;
  }
}
