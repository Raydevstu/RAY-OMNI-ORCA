import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const orchDir = (root: string) => join(resolve(root), '.orch');
export function ensureDir(p: string): string { mkdirSync(p, { recursive: true }); return p; }
export const rootFromEnv = () => resolve(process.env.ORCH_ROOT ?? process.cwd());

/** Skills shipped with the package (dist/src/core -> package root/skills). */
export const bundledSkills = join(dirname(fileURLToPath(import.meta.url)), '../../../skills');

/**
 * Resolve a repo-relative write target and jail it inside root.
 * Returns the normalized forward-slash path. Throws on `..` escape,
 * symlink components (lstat, no-follow), or a real parent outside root.
 * Note: check-then-write has the usual local TOCTOU limit against an
 * adversarial local process swapping paths between check and write;
 * sufficient for developer-machine use, not for hostile multi-tenant hosts.
 */
export function jailPath(root: string, file: string): string {
  const abs = resolve(root, file);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || abs === root) throw new Error(`Path escapes project root: ${file}`);
  const norm = rel.split(sep).join('/');
  let cur = root;
  for (const part of norm.split('/')) {
    cur = join(cur, part);
    let st: { isSymbolicLink(): boolean };
    try { st = lstatSync(cur); } catch { break; } // not yet existing: nothing to follow
    if (st.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${norm}`);
  }
  const parent = join(abs, '..');
  try {
    const realParent = realpathSync(parent);
    const realRoot = realpathSync(root);
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep) && !realParent.startsWith(realRoot + '/')) {
      throw new Error(`Refusing to write outside project root: ${norm}`);
    }
  } catch (e) {
    if ((e as Error).message.startsWith('Refusing')) throw e;
    // Parent does not exist yet: component lstat walk above already ruled out symlinks.
  }
  return norm;
}
