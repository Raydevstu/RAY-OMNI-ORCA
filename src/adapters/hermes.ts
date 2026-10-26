import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { type Action, installAgentsBlock, installSkills, paths, writeFile } from './shared.js';

export const hermesHome = (override?: string) => override ?? process.env.HERMES_HOME ?? join(homedir(), '.hermes');
export const serverName = (root: string) => `orch-${basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function hermesPresent(home: string): boolean {
  return existsSync(home) || spawnSync(process.platform === 'win32' ? 'where' : 'which', ['hermes']).status === 0;
}
export function installHermes(root: string, opts: { dry?: boolean; home?: string; force?: boolean } = {}): Action[] | null {
  const home = hermesHome(opts.home), dry = opts.dry ?? false;
  if (!opts.force && !hermesPresent(home)) return null;
  const actions = [installAgentsBlock(root, dry), installSkills(root, dry)];
  const cfg = join(home, 'config.yaml');
  const doc = parseDocument(existsSync(cfg) ? readFileSync(cfg, 'utf8') : '{}');
  doc.setIn(['mcp_servers', serverName(root)], { command: 'node', args: [paths.server], env: { ORCH_ROOT: root } });
  const ext = (doc.getIn(['skills', 'external_dirs']) as { toJSON?: () => string[] } | undefined)?.toJSON?.() ?? [];
  const skillsDir = join(root, '.agents/skills');
  const orchSkillsDir = join(skillsDir, 'orch');
  const merged = [...ext];
  for (const d of [skillsDir, orchSkillsDir]) if (!merged.includes(d)) merged.push(d);
  doc.setIn(['skills', 'external_dirs'], merged);
  writeFile(cfg, String(doc), dry);
  actions.push({ path: cfg, action: `MCP server "${serverName(root)}" and skills directory` });
  return actions;
}
