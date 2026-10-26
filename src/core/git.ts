import { spawnSync } from 'node:child_process';

export function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}
export interface Changes { changed: string[]; deleted: string[] }
export function changedFiles(root: string): Changes {
  // Null-delimited: handles spaces, quotes, newlines and renames correctly.
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd: root, encoding: 'buffer' });
  const changed: string[] = [], deleted: string[] = [];
  if (r.status !== 0) return { changed, deleted };
  const buf = (r.stdout ?? Buffer.alloc(0)) as Buffer;
  const recs = buf.toString('utf8').split('\0').filter(Boolean);
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const status = rec.slice(0, 2);
    let file = rec.slice(3);
    // Rename records are "R  new\0old" (old path follows as its own NUL record in -z mode).
    if ((status[0] === 'R' || status[1] === 'R') && i + 1 < recs.length && !/^[A-Z?! ]{1,2} /.test(recs[i + 1])) {
      file = recs[i + 1]; i++;
    } else {
      file = file.replace(/^.* -> /, '');
    }
    file = file.replace(/^"|"$/g, '');
    if (file.startsWith('.orch/')) continue;
    (status.includes('D') ? deleted : changed).push(file);
  }
  return { changed, deleted };
}
