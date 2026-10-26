import { classify } from './gates.js';
import { checklistFor, type EdgeCase } from './edgecases.js';
import type { ProjectMap } from './indexer.js';

export interface Spec {
  status: 'ready' | 'needs_clarification';
  goal: string; questions: string[]; areas: string[]; acceptance: string[]; risk: string[]; edgeCases: EdgeCase[];
}
const TARGET = /([\w-]+\/[\w./-]+|\b[\w-]+\.(ts|tsx|js|jsx|css|html|json|py|md)\b|`[^`]+`|\b(page|component|endpoint|route|form|button|api|function|table|hook|modal|navbar|header|footer|test|schema|model|screen|view|service|handler)\b)/i;
const OUTCOME = /\b(should|so that|when|must|returns?|show(s)?|display(s)?|validate(s)?|redirect(s)?|error|instead of|because|until|if|only|at least|no more)\b/i;
const VAGUE = /^\s*(make|fix|improve|update|change|clean)\s+(it|this|that|things?|everything)\b/i;

export function compileTask(prompt: string, map: ProjectMap): Spec {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const hasTarget = TARGET.test(prompt);
  const hasOutcome = OUTCOME.test(prompt) || words.length >= 14;
  const risk = [...new Set(classify({ text: prompt }).reasons.map(r => r.gate))];
  const questions: string[] = [];
  if (!hasTarget) questions.push('Which page, file or feature should change?');
  if (!hasOutcome) questions.push('What should be true when this is done (the visible result or a check I can run)?');
  if (risk.some(r => r === 'auth' || r === 'payment') && words.length < 20)
    questions.push('Which user roles or data does this affect, and must existing behavior stay unchanged?');
  const needs = VAGUE.test(prompt) || !hasTarget || (!hasOutcome && words.length < 8) || words.length < 3;
  const lower = prompt.toLowerCase();
  const areas = map.dirs.filter(d => lower.includes(d.toLowerCase()));
  const acceptance: string[] = [];
  for (const s of ['test', 'lint', 'typecheck'] as const) if (map.scripts[s] && !/no test specified/.test(map.scripts[s])) acceptance.push(`\`${s}\` passes`);
  acceptance.push('No new secrets or unverified dependencies are introduced');
  const edgeCases = needs ? [] : checklistFor(`${prompt} ${areas.join(' ')}`);
  if (edgeCases.length) acceptance.push('Each listed edge case is handled and has a test');
  if (hasOutcome) acceptance.push(`Behavior matches the request: "${prompt.trim().slice(0, 160)}"`);
  return { status: needs ? 'needs_clarification' : 'ready', goal: prompt.trim(), questions: needs ? questions.slice(0, 3) : [], areas, acceptance, risk, edgeCases };
}
