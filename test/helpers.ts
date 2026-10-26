import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function fixture(opts: { git?: boolean; scripts?: Record<string, string> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'orch-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: opts.scripts ?? { test: 'node -e "process.exit(0)"' }, dependencies: { react: '^18.0.0' } }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/app.ts'), 'export const a = 1;\n');
  if (opts.git !== false) {
    const g = (...a: string[]) => spawnSync('git', a, { cwd: root });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '-A'); g('commit', '-qm', 'init');
  }
  return root;
}
