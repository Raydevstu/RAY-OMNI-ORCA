import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ensureDir, orchDir } from './paths.js';

export const ConfigSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).default(30),
  excludedPaths: z.array(z.string()).default(['.env*', 'secrets/**', 'vendor/**']),
  maxEventFileBytes: z.number().int().default(5_000_000),
  maxMemoryItems: z.number().int().default(500),
  networkDependencyAudit: z.boolean().default(false),
});
export type OrchConfig = z.infer<typeof ConfigSchema>;

export const configPath = (root: string) =>
  join(ensureDir(orchDir(root)), 'config.json');

export function loadConfig(root: string): OrchConfig {
  const p = configPath(root);
  if (!existsSync(p)) {
    const d = ConfigSchema.parse({});
    writeFileSync(p, JSON.stringify(d, null, 2));
    return d;
  }
  return ConfigSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

// tiny glob: supports `*.ext`, `.env*`, `dir/**`
export function isExcluded(relPath: string, cfg: OrchConfig): boolean {
  const rel = relPath.replace(/\\/g, '/');
  for (const pat of cfg.excludedPaths) {
    if (pat.endsWith('/**')) {
      if (rel.startsWith(pat.slice(0, -3))) return true;
    } else if (pat.endsWith('*')) {
      const prefix = pat.slice(0, -1);
      if (rel.startsWith(prefix)) return true;
      const base = pat.replace('*', '');
      const leaf = rel.split('/').pop() ?? '';
      if (leaf.startsWith(base)) return true;
    } else if (rel === pat || rel.includes(pat)) return true;
  }
  return false;
}
