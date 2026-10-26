import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.js';
import { ensureDir, orchDir } from './paths.js';

const file = (root: string) => join(ensureDir(orchDir(root)), 'checkpoints.json');
const load = (root: string): Record<string, string> => existsSync(file(root)) ? JSON.parse(readFileSync(file(root), 'utf8')) : {};

/** Snapshot tracked files without touching the working tree. Untracked files are not captured. */
export function createCheckpoint(root: string, id: string): { ok: boolean; sha?: string; note: string } {
  if (!git(root, ['rev-parse', '--git-dir']).ok) return { ok: false, note: 'Not a git repository; no checkpoint created.' };
  if (!git(root, ['rev-parse', 'HEAD']).ok) return { ok: false, note: 'Repository has no commits yet; make an initial commit first.' };
  const stash = git(root, ['stash', 'create']);
  const sha = stash.ok && stash.out ? stash.out : git(root, ['rev-parse', 'HEAD']).out;
  git(root, ['update-ref', `refs/orch/${id}`, sha]);
  const all = load(root); all[id] = sha; writeFileSync(file(root), JSON.stringify(all, null, 2));
  return { ok: true, sha, note: 'Checkpoint saved. Untracked files are not included.' };
}

export function rollback(root: string, id: string): { ok: boolean; note: string } {
  const sha = load(root)[id];
  if (!sha) return { ok: false, note: `No checkpoint named ${id}.` };
  const r = git(root, ['checkout', sha, '--', '.']);
  return r.ok ? { ok: true, note: 'Tracked files restored. Files created after the checkpoint were left in place; review them with git status.' }
    : { ok: false, note: 'Rollback failed; nothing was changed.' };
}
