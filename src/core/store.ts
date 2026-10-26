import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, orchDir } from './paths.js';
import { envValues, redactDeep } from './redact.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_items(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, prompt TEXT NOT NULL, spec TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_events(id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT, type TEXT NOT NULL, data TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS confirmations(fingerprint TEXT PRIMARY KEY, taskId TEXT NOT NULL, gates TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, approvedAt TEXT);
CREATE TABLE IF NOT EXISTS verification_runs(id TEXT PRIMARY KEY, taskId TEXT, result TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_rules(id TEXT PRIMARY KEY, rule TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_scratchpad(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const cache = new Map<string, DatabaseSync>();

export function openStore(root: string): DatabaseSync {
  const hit = cache.get(root);
  if (hit) return hit;
  const db = new DatabaseSync(join(ensureDir(orchDir(root)), 'orch.db'));
  db.exec(SCHEMA);
  // Column added after v1: execution binding (approved-action fingerprint per task).
  try {
    const cols = db.prepare('PRAGMA table_info(tasks)').all() as unknown as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'execution')) db.exec('ALTER TABLE tasks ADD COLUMN execution TEXT');
  } catch { /* best-effort */ }
  migrateOnce(root, db);
  cache.set(root, db);
  return db;
}

export function closeStore(root: string) {
  cache.get(root)?.close();
  cache.delete(root);
}

function migrateOnce(root: string, db: DatabaseSync) {
  try {
    const legacy = join(orchDir(root), 'memory.db');
    if (existsSync(legacy)) {
      const count = (db.prepare('SELECT COUNT(*) as c FROM memory_items').get() as unknown as { c: number }).c;
      if (count === 0) {
        const old = new DatabaseSync(legacy);
        const rows = old.prepare('SELECT * FROM memory_items').all() as unknown as Array<{ kind: string; text: string; source: string; status: string; created_at: string }>;
        const secrets = envValues(root);
        for (const r of rows) {
          const safe = redactDeep(String(r.text), secrets) as string;
          db.prepare('INSERT INTO memory_items(kind,text,source,status,created_at) VALUES(?,?,?,?,?)')
            .run(r.kind, safe, r.source, r.status, r.created_at);
        }
        old.close();
        renameSync(legacy, legacy + '.migrated');
      }
    }
  } catch { /* best-effort */ }
  try {
    const tf = join(orchDir(root), 'tasks.json');
    if (existsSync(tf)) {
      const arr = JSON.parse(readFileSync(tf, 'utf8'));
      if (Array.isArray(arr) && arr.length) {
        const secrets = envValues(root);
        for (const t of arr) {
          const safePrompt = redactDeep(String(t.prompt ?? ''), secrets) as string;
          const safeSpec = redactDeep(t.spec ?? {}, secrets) as unknown;
          db.prepare('INSERT OR IGNORE INTO tasks(id,prompt,spec,status,createdAt) VALUES(?,?,?,?,?)')
            .run(String(t.id), safePrompt, JSON.stringify(safeSpec), String(t.status ?? 'started'), String(t.createdAt ?? new Date().toISOString()));
        }
        renameSync(tf, tf + '.migrated');
      }
    }
  } catch { /* best-effort */ }
}
