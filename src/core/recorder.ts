import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, orchDir } from './paths.js';
import { envValues, redact } from './redact.js';

export interface OrchEvent { ts: string; type: string; data: unknown }

export class Recorder {
  private secrets: string[];
  constructor(private root: string) { this.secrets = envValues(root); }
  private dir() { return ensureDir(join(orchDir(this.root), 'events')); }

  record(type: string, data: unknown = {}): OrchEvent {
    const ev: OrchEvent = { ts: new Date().toISOString(), type, data };
    // Redact the serialized form so nothing sensitive reaches disk, whatever the shape.
    const line = redact(JSON.stringify(ev), this.secrets);
    appendFileSync(join(this.dir(), `${ev.ts.slice(0, 10)}.jsonl`), line + '\n');
    return JSON.parse(line) as OrchEvent;
  }

  recent(n = 20): OrchEvent[] {
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
