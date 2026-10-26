import { randomBytes } from 'node:crypto';
import { openStore } from './store.js';
import { envValues, redactDeep } from './redact.js';
import type { Spec } from './compiler.js';

export interface Task { id: string; prompt: string; spec: Spec; status: string; createdAt: string; execution?: string | null }

export function saveTask(root: string, prompt: string, spec: Spec): Task {
  const secrets = envValues(root);
  const t: Task = {
    id: `t${Date.now().toString(36)}${randomBytes(2).toString('hex')}`,
    prompt: redactDeep(prompt, secrets) as string,
    spec: redactDeep(spec, secrets) as Spec,
    status: 'started',
    createdAt: new Date().toISOString(),
  };
  openStore(root).prepare(
    'INSERT OR REPLACE INTO tasks(id,prompt,spec,status,createdAt) VALUES(?,?,?,?,?)'
  ).run(t.id, t.prompt, JSON.stringify(t.spec), t.status, t.createdAt);
  return t;
}

export function loadTasks(root: string): Task[] {
  const rows = openStore(root).prepare('SELECT * FROM tasks ORDER BY createdAt').all() as unknown as Array<{ id: string; prompt: string; spec: string; status: string; createdAt: string }>;
  return rows.map(r => ({ id: r.id, prompt: r.prompt, spec: JSON.parse(r.spec), status: r.status, createdAt: r.createdAt }));
}

export function getTask(root: string, id: string): Task | null {
  const r = openStore(root).prepare('SELECT * FROM tasks WHERE id=?').get(id) as unknown as { id: string; prompt: string; spec: string; status: string; createdAt: string; execution?: string | null } | undefined;
  if (!r) return null;
  return { id: r.id, prompt: r.prompt, spec: JSON.parse(r.spec), status: r.status, createdAt: r.createdAt, execution: r.execution ?? null };
}

export function setTaskStatus(root: string, id: string, status: string) {
  openStore(root).prepare('UPDATE tasks SET status=? WHERE id=?').run(status, id);
}

/** Bind the approved-action fingerprint that begin_execution authorized. */
export function setTaskExecution(root: string, id: string, fp: string) {
  openStore(root).prepare('UPDATE tasks SET status=?, execution=? WHERE id=?').run('executing', fp, id);
}
