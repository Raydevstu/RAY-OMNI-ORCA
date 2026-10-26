import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export interface Skill { name: string; description: string; triggers: string[]; risk: string; body: string; dir: string }
export interface Selection { name: string; score: number; reasons: string[]; risk: string }

const Frontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  triggers: z.union([z.array(z.coerce.string()), z.string()]).optional(),
  risk: z.coerce.string().optional(),
});

function normalizeTriggers(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((s) => String(s).split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function parseSkill(md: string, dir: string): Skill | null {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  let data: unknown;
  try { data = parse(m[1]); } catch { return null; }
  const r = Frontmatter.safeParse(data);
  if (!r.success) return null;
  return {
    name: r.data.name.trim(),
    description: r.data.description.trim(),
    triggers: normalizeTriggers(r.data.triggers),
    risk: r.data.risk ?? 'low',
    body: m[2],
    dir,
  };
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
