import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, orchDir } from './paths.js';

export interface ProjectMap {
  root: string; name: string; packageManager: string; frameworks: string[];
  scripts: Record<string, string>; dirs: string[]; hasTests: boolean; isGit: boolean; indexedAt: string;
  workspaces: string[]; configs: string[]; srcDirs: string[]; docFiles: string[]; contentHash: string;
}
const FRAMEWORKS: Record<string, string> = {
  next: 'Next.js', vite: 'Vite', react: 'React', vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  express: 'Express', fastify: 'Fastify', '@nestjs/core': 'NestJS', tailwindcss: 'Tailwind CSS',
  typescript: 'TypeScript', vitest: 'Vitest', jest: 'Jest', prisma: 'Prisma',
};
const SKIP = new Set(['node_modules', 'dist', 'build', '.next', '.git', '.orch', 'coverage']);

export function indexProject(root: string): ProjectMap {
  const pkgPath = join(root, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
  const pm = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(join(root, 'yarn.lock')) ? 'yarn'
    : existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock')) ? 'bun'
    : existsSync(pkgPath) ? 'npm' : 'unknown';
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && !SKIP.has(d.name) && !d.name.startsWith('.')).map(d => d.name).sort();
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  // Workspaces (npm/pnpm/yarn) + pnpm workspace file.
  const workspaces: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces
    : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : [];
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) {
    try {
      const y = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
      for (const m of y.matchAll(/-\s*['"]?([^*'"\s][^'"\s]*)['"]?/g)) workspaces.push(m[1]);
    } catch { /* ignore */ }
  }
  // Known config files present at root.
  const CONFIGS = ['tsconfig.json', 'tsconfig.base.json', '.eslintrc.json', '.eslintrc.js', 'eslint.config.js', 'eslint.config.mjs', 'prettier.config.js', '.prettierrc', '.prettierrc.json', 'vitest.config.ts', 'vitest.config.js', 'jest.config.js', 'jest.config.ts', 'playwright.config.ts'];
  const configs = CONFIGS.filter(c => existsSync(join(root, c)));
  // Conventional source/test locations.
  const SRCS = ['src', 'apps', 'packages', 'lib', 'app', 'components', 'test', 'tests', '__tests__', 'spec', 'e2e'];
  const srcDirs = SRCS.filter(d => existsSync(join(root, d)));
  // Root-level instruction docs.
  const docs = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md'].filter(d => existsSync(join(root, d)));
  // Cheap incremental marker: max mtime of package.json + configs.
  let contentHash = '';
  try {
    const mtimes = [pkgPath, ...configs.map(c => join(root, c))]
      .filter(p => existsSync(p)).map(p => statSync(p).mtimeMs);
    contentHash = `mtimes:${Math.max(0, ...mtimes)}`;
  } catch { /* ignore */ }
  const map: ProjectMap = {
    root, name: pkg.name ?? root.split('/').pop() ?? 'project', packageManager: pm,
    frameworks: Object.keys(FRAMEWORKS).filter(k => k in deps).map(k => FRAMEWORKS[k]),
    scripts, dirs,
    hasTests: Boolean(scripts.test && !/no test specified/.test(scripts.test)) || dirs.some(d => /^(tests?|__tests__)$/.test(d)),
    isGit: existsSync(join(root, '.git')), indexedAt: new Date().toISOString(),
    workspaces: [...new Set(workspaces)], configs, srcDirs, docFiles: docs, contentHash,
  };
  const dir = ensureDir(orchDir(root));
  writeFileSync(join(dir, 'project-map.json'), JSON.stringify(map, null, 2));
  writeFileSync(join(dir, 'PROJECT.md'), renderProjectMd(map));
  return map;
}

export function loadProjectMap(root: string): ProjectMap {
  const p = join(orchDir(root), 'project-map.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : indexProject(root);
}

function renderProjectMd(m: ProjectMap): string {
  return [`# ${m.name}`, '', `- Package manager: ${m.packageManager}`,
    `- Stack: ${m.frameworks.join(', ') || 'not detected'}`, `- Top-level folders: ${m.dirs.join(', ') || 'none'}`,
    `- Source dirs: ${m.srcDirs.join(', ') || 'none'}`,
    `- Workspaces: ${m.workspaces.join(', ') || 'none'}`,
    `- Configs: ${m.configs.join(', ') || 'none'}`,
    `- Docs: ${m.docFiles.join(', ') || 'none'}`,
    `- Tests present: ${m.hasTests ? 'yes' : 'no'}`, '', '## Scripts',
    ...Object.entries(m.scripts).map(([k, v]) => `- \`${k}\`: \`${v}\``), ''].join('\n');
}
