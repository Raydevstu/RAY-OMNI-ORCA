import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Kind = 'form' | 'api' | 'auth' | 'data' | 'ui' | 'async';
export interface EdgeCase { id: string; label: string }
interface Def extends EdgeCase { kinds: Kind[] | 'all'; test: RegExp }

const KIND_WORDS: Record<Kind, RegExp> = {
  form: /\b(form|input|field|validat\w*|email|upload|submit|signup|sign-up|register)\b/i,
  api: /\b(endpoint|route|api|fetch|request|handler|controller|webhook|http)\b/i,
  auth: /\b(auth\w*|login|log in|permission|role|session|password|token|admin)\b/i,
  data: /\b(list|table|search|filter|pagination|paginate|query|database|db|sort|report|export)\b/i,
  ui: /\b(component|page|button|modal|layout|css|style|responsive|navbar|header|footer|menu|screen|dialog|\.tsx|\.jsx|\.vue|\.svelte|\.css)\b/i,
  async: /\b(async|queue|webhook|payment|checkout|concurrent|retry|upload|job|background|stream)\b/i,
};

// Ordered by priority; at most MAX are shown so the list stays short enough to act on.
const DEFS: Def[] = [
  { id: 'error-path', label: 'Failures show a clear error and do not crash or leave partial state', kinds: 'all', test: /\b(error|fail(s|ed|ure)?|throws?|rejects?|catch|exception)\b/i },
  { id: 'empty-input', label: 'Empty, missing or whitespace-only input', kinds: ['form', 'api', 'data'], test: /\b(empty|blank|missing|undefined|null|whitespace|required)\b/i },
  { id: 'invalid-input', label: 'Invalid or malformed input is rejected with a useful message', kinds: ['form', 'api'], test: /\b(invalid|malformed|reject\w*|bad (input|format|request)|wrong format|not valid)\b/i },
  { id: 'unauthorized', label: 'Unauthenticated or unauthorized users are refused', kinds: ['auth', 'api'], test: /\b(unauthori[sz]ed|forbidden|401|403|unauthenticated|not logged in|permission denied|access denied)\b/i },
  { id: 'network-failure', label: 'Network failure, timeout or server error is handled', kinds: ['api', 'async', 'data', 'ui'], test: /\b(timeout|timed out|network|offline|500|502|503|abort\w*|retry|retries)\b/i },
  { id: 'empty-results', label: 'Empty result set or no-data state', kinds: ['data', 'ui'], test: /\b(no results|empty (list|state|array|table|result)|zero results|none found|no data)\b/i },
  { id: 'boundary-size', label: 'Very large, very long or boundary-size input', kinds: ['form', 'data', 'api'], test: /\b(max(imum)?|min(imum)?|limit|too (long|big|large|many)|very (long|large)|boundary|overflow)\b/i },
  { id: 'duplicate-submit', label: 'Double click, duplicate submit or concurrent requests', kinds: ['async', 'form'], test: /\b(duplicate|double[- ]?(click|submit)|concurrent|race|idempoten\w*|twice|parallel)\b/i },
  { id: 'a11y-responsive', label: 'Keyboard use, screen-reader labels and small screens', kinds: ['ui'], test: /\b(aria|label|keyboard|focus|a11y|accessib\w*|mobile|responsive|viewport|screen reader)\b/i },
];
const MAX = 6;

export function detectKinds(text: string): Kind[] {
  return (Object.keys(KIND_WORDS) as Kind[]).filter(k => KIND_WORDS[k].test(text));
}
export function checklistFor(text: string): EdgeCase[] {
  const kinds = detectKinds(text);
  return DEFS.filter(d => d.kinds === 'all' || d.kinds.some(k => kinds.includes(k))).slice(0, MAX).map(({ id, label }) => ({ id, label }));
}

export interface Coverage {
  testFilesChanged: string[];
  items: (EdgeCase & { status: 'covered' | 'not_covered' })[];
  note: string;
}
const TEST_PATH = /(\.|_)(test|spec)\.[a-z]+$|(^|\/)(__tests__|tests?|spec)\//i;

/** Heuristic only: looks for edge-case keywords in test files that changed. It is not proof of real coverage. */
export function assessCoverage(root: string, changedFiles: string[], items: EdgeCase[]): Coverage {
  const testFiles = changedFiles.filter(f => TEST_PATH.test(f));
  let body = '';
  for (const f of testFiles) {
    const p = join(root, f);
    if (existsSync(p) && statSync(p).isFile() && statSync(p).size < 300_000) body += readFileSync(p, 'utf8') + '\n';
  }
  const out = items.map(i => ({ ...i, status: (body && DEFS.find(d => d.id === i.id)!.test.test(body) ? 'covered' : 'not_covered') as 'covered' | 'not_covered' }));
  return { testFilesChanged: testFiles, items: out,
    note: testFiles.length ? 'Heuristic: keyword match in changed test files, not proof of coverage.' : 'No test files changed, so none of these edge cases are covered by new tests.' };
}
