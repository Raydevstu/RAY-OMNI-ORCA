import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { changedFiles, git } from './git.js';
import { classify } from './gates.js';
import { detectSecrets, envValues, redact } from './redact.js';
import { assessCoverage, checklistFor, type Coverage } from './edgecases.js';
import { loadTasks } from './tasks.js';
import type { ProjectMap } from './indexer.js';

export interface Finding { severity: 'high' | 'medium' | 'info'; kind: string; detail: string }
export interface CheckResult { name: string; status: 'passed' | 'failed' | 'skipped'; output?: string }
export interface VerifyReport { ok: boolean; checks: CheckResult[]; findings: Finding[]; gates: ReturnType<typeof classify>; changed: string[]; edgeCases: Coverage | null }

const COMMANDS = ['test', 'lint', 'typecheck'] as const;

export function runCommands(root: string, map: ProjectMap): CheckResult[] {
  const secrets = envValues(root);
  return COMMANDS.map(name => {
    const script = map.scripts[name];
    if (!script || /no test specified/.test(script)) return { name, status: 'skipped' as const, output: 'no script defined' };
    const r = spawnSync(map.packageManager === 'unknown' ? 'npm' : map.packageManager, ['run', name], { cwd: root, encoding: 'utf8', timeout: 180_000 });
    const tail = redact(`${r.stdout ?? ''}${r.stderr ?? ''}`, secrets).split('\n').slice(-15).join('\n');
    return { name, status: r.status === 0 ? 'passed' as const : 'failed' as const, output: tail };
  });
}

export function scanChangedFiles(root: string, files: string[]): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p) || !statSync(p).isFile() || statSync(p).size > 200_000) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    const kinds = detectSecrets(buf.toString('utf8'));
    if (kinds.length) out.push({ severity: 'high', kind: 'secret', detail: `${f}: possible ${[...new Set(kinds)].join(', ')}` });
  }
  return out;
}

function deps(json: string | null): Record<string, string> {
  if (!json) return {};
  try { const p = JSON.parse(json); return { ...p.dependencies, ...p.devDependencies }; } catch { return {}; }
}
export function addedDependencies(root: string): string[] {
  const now = existsSync(join(root, 'package.json')) ? readFileSync(join(root, 'package.json'), 'utf8') : null;
  const head = git(root, ['show', 'HEAD:package.json']);
  const before = deps(head.ok ? head.out : null);
  return Object.keys(deps(now)).filter(n => !(n in before));
}

export async function checkRegistry(names: string[], fetchFn: typeof fetch = fetch): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const name of names.slice(0, 10)) {
    try {
      const res = await fetchFn(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, { signal: AbortSignal.timeout(5000) });
      if (res.status === 404) { out.push({ severity: 'high', kind: 'dependency', detail: `${name}: not found in the npm registry (possible invented package name)` }); continue; }
      if (!res.ok) { out.push({ severity: 'info', kind: 'dependency', detail: `${name}: could not be verified (HTTP ${res.status})` }); continue; }
      const doc = await res.json() as { time?: { created?: string } };
      const created = doc.time?.created ? Date.parse(doc.time.created) : NaN;
      if (!Number.isNaN(created) && Date.now() - created < 30 * 86_400_000)
        out.push({ severity: 'medium', kind: 'dependency', detail: `${name}: package is less than 30 days old; review before trusting` });
    } catch { out.push({ severity: 'info', kind: 'dependency', detail: `${name}: could not be verified (network unavailable)` }); }
  }
  return out;
}

export async function verify(root: string, map: ProjectMap, opts: { network?: boolean; fetchFn?: typeof fetch } = {}): Promise<VerifyReport> {
  const { changed, deleted } = changedFiles(root);
  const checks = runCommands(root, map);
  const findings = scanChangedFiles(root, changed);
  const added = addedDependencies(root);
  if (added.length) {
    findings.push({ severity: 'info', kind: 'dependency', detail: `new dependencies: ${added.join(', ')}` });
    if (opts.network !== false) findings.push(...await checkRegistry(added, opts.fetchFn));
  }
  const gates = classify({ paths: [...changed, ...deleted], deletedPaths: deleted });
  let edgeCases: Coverage | null = null;
  if (changed.length) {
    const prompt = loadTasks(root).at(-1)?.prompt ?? '';
    edgeCases = assessCoverage(root, changed, checklistFor(`${prompt} ${changed.join(' ')}`));
    const missing = edgeCases.items.filter(i => i.status === 'not_covered');
    if (missing.length) findings.push({ severity: 'medium', kind: 'edge-case', detail: `${missing.length} of ${edgeCases.items.length} expected edge cases have no matching test (heuristic): ${missing.map(m => m.id).join(', ')}` });
  }
  return { ok: !findings.some(f => f.severity === 'high') && !checks.some(c => c.status === 'failed'), checks, findings, gates, changed: [...changed, ...deleted], edgeCases };
}

export function explainChanges(root: string, report?: VerifyReport): string {
  const { changed, deleted } = changedFiles(root);
  const stat = git(root, ['diff', '--stat', 'HEAD']);
  const gates = classify({ paths: [...changed, ...deleted], deletedPaths: deleted });
  const lines = [`Files changed: ${changed.length}, removed: ${deleted.length}`, stat.ok && stat.out ? stat.out : '(no tracked-file diff available)'];
  lines.push(gates.confirm ? `Needs your review: ${gates.reasons.map(r => r.why).join('; ')}` : 'No high-risk areas touched.');
  if (report) lines.push(`Checks: ${report.checks.map(c => `${c.name}=${c.status}`).join(', ')}; findings: ${report.findings.filter(f => f.severity !== 'info').length}`);
  if (report?.edgeCases) lines.push(`Edge cases: ${report.edgeCases.items.filter(i => i.status === 'covered').length}/${report.edgeCases.items.length} have a matching test (heuristic)`);
  return lines.join('\n');
}
