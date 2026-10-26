import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Skill { name: string; description: string; triggers: string[]; risk: string; body: string; dir: string }
export interface Selection { name: string; score: number; reasons: string[]; risk: string }

export function parseSkill(md: string, dir: string): Skill | null {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  if (!fm.name || !fm.description) return null;
  const triggers = (fm.triggers ?? '').replace(/^\[|\]$/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return { name: fm.name, description: fm.description, triggers, risk: fm.risk ?? 'low', body: m[2], dir };
}

export function loadSkills(dirs: string[]): Skill[] {
  const seen = new Map<string, Skill>();
  for (const base of dirs) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      const f = join(base, d.name, 'SKILL.md');
      if (!d.isDirectory() || !existsSync(f)) continue;
      const s = parseSkill(readFileSync(f, 'utf8'), join(base, d.name));
      if (s && !seen.has(s.name)) seen.set(s.name, s);
    }
  }
  return [...seen.values()];
}

export function selectSkills(text: string, skills: Skill[], max = 3): Selection[] {
  const lower = text.toLowerCase();
  return skills.map(s => {
    const reasons = s.triggers.filter(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(lower));
    return { name: s.name, score: reasons.length, reasons, risk: s.risk };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, max);
}
