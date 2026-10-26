import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const orchDir = (root: string) => join(resolve(root), '.orch');
export function ensureDir(p: string): string { mkdirSync(p, { recursive: true }); return p; }
export const rootFromEnv = () => resolve(process.env.ORCH_ROOT ?? process.cwd());

/** Skills shipped with the package (dist/src/core -> package root/skills). */
export const bundledSkills = join(dirname(fileURLToPath(import.meta.url)), '../../../skills');
