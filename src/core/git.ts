import { spawnSync } from 'node:child_process';

export function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}
export interface Changes { changed: string[]; deleted: string[] }
export function changedFiles(root: string): Changes {
  const r = git(root, ['status', '--porcelain', '-uall']);
  const changed: string[] = [], deleted: string[] = [];
  if (!r.ok) return { changed, deleted };
  for (const line of r.out.split('\n').filter(Boolean)) {
    const status = line.slice(0, 2), file = line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '');
    if (file.startsWith('.orch/')) continue;
    (status.includes('D') ? deleted : changed).push(file);
  }
  return { changed, deleted };
}
