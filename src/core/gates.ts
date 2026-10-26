export type Gate = 'delete' | 'migration' | 'auth' | 'payment' | 'secret' | 'dependency';
export interface GateResult { confirm: boolean; reasons: { gate: Gate; why: string }[] }

const TEXT_RULES: [Gate, RegExp, string][] = [
  ['delete', /\b(rm\s+-rf|drop\s+table|truncate\s+table|force[- ]push|git\s+push\s+(-f|--force)|delete\s+(all|the)\b)/i, 'destructive operation'],
  ['migration', /\bmigrat(e|ion|ions)\b/i, 'database migration'],
  ['auth', /\b(auth|authentication|authorization|login|log in|session|password|permission|jwt|oauth|rbac)\b/i, 'authentication or permissions'],
  ['payment', /\b(payment|stripe|billing|checkout|invoice|subscription)\b/i, 'payments or billing'],
  ['secret', /(\.env\b|\bsecrets?\b|credentials?|api[_-]?key|\.pem\b)/i, 'secrets or environment config'],
  ['dependency', /\b(npm|pnpm|yarn)\s+(install|add|remove|uninstall)\b|\b(add|install|remove|upgrade)\b[^.]{0,30}\b(package|dependency|dependencies|library)\b/i, 'dependency change'],
];
const PATH_RULES: [Gate, RegExp, string][] = [
  ['migration', /(^|\/)(migrations?|prisma\/migrations)(\/|$)/i, 'migration file'],
  ['auth', /(^|\/)(auth|login|session|permissions?|middleware)[^/]*(\/|\.|$)/i, 'auth-related file'],
  ['payment', /(payment|stripe|billing|checkout)/i, 'payments-related file'],
  ['secret', /(^|\/)\.env(\.|$)|\.pem$|(^|\/)secrets?(\/|\.)/i, 'secrets or env file'],
  ['dependency', /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i, 'dependency manifest'],
];

export function classify(input: { paths?: string[]; text?: string; deletedPaths?: string[] }): GateResult {
  const reasons: GateResult['reasons'] = [];
  const add = (gate: Gate, why: string) => { if (!reasons.some(r => r.gate === gate && r.why === why)) reasons.push({ gate, why }); };
  if (input.text) for (const [g, re, why] of TEXT_RULES) if (re.test(input.text)) add(g, why);
  for (const p of input.paths ?? []) for (const [g, re, why] of PATH_RULES) if (re.test(p)) add(g, `${why}: ${p}`);
  for (const p of input.deletedPaths ?? []) add('delete', `file removed: ${p}`);
  return { confirm: reasons.length > 0, reasons };
}

/** Gate detection for a proposed edit. Scans the FULL content (rules are linear-time
 *  regexes) so a risky token late in a long file still triggers its gate. */
export function detectEditGates(file: string, content: string): GateResult['reasons'] {
  const seen = new Map<string, string>();
  for (const r of classify({ text: `${file}\n${content}`, paths: [file] }).reasons) seen.set(r.gate, r.why);
  return [...seen].map(([gate, why]) => ({ gate: gate as Gate, why }));
}
