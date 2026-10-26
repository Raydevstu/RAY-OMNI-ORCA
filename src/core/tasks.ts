import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureDir, orchDir } from './paths.js';
import type { Spec } from './compiler.js';

export interface Task { id: string; prompt: string; spec: Spec; status: string; createdAt: string }
const file = (root: string) => join(ensureDir(orchDir(root)), 'tasks.json');
export const loadTasks = (root: string): Task[] => existsSync(file(root)) ? JSON.parse(readFileSync(file(root), 'utf8')) : [];
export function saveTask(root: string, prompt: string, spec: Spec): Task {
  const t: Task = { id: `t${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, prompt, spec, status: 'started', createdAt: new Date().toISOString() };
  writeFileSync(file(root), JSON.stringify([...loadTasks(root), t], null, 2));
  return t;
}
