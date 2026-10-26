import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'api-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
];
const ASSIGNMENT =
  /\b((?:api[_-]?key|secret|token|password|passwd|private[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*)(["']?)([^\s"',;]{8,})/gi;

/** Values from .env files (not .env.example) so literal occurrences can be scrubbed. */
export function envValues(root: string): string[] {
  const out = new Set<string>();
  try {
    for (const f of readdirSync(root)) {
      if (!f.startsWith('.env') || /example|sample|template/i.test(f)) continue;
      const p = join(root, f);
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
        const v = m?.[1]?.trim().replace(/^["']|["']$/g, '');
        if (v && v.length >= 6) out.add(v);
      }
    }
  } catch { /* unreadable root: nothing to scrub */ }
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text: string, extra: string[] = []): string {
  let out = text;
  for (const v of extra) out = out.split(v).join('[REDACTED:env-value]');
  for (const { name, re } of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${name}]`);
  return out.replace(ASSIGNMENT, '$1$2[REDACTED:assignment]');
}

export function detectSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) if (text.match(re)) hits.push(name);
  if (/\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?(?!\[REDACTED)[^\s"',;]{8,}/i.test(text)) hits.push('assignment');
  return hits;
}
