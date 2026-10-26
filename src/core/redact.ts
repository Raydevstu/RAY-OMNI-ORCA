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

const SENSITIVE_KEYS =
  /(token|password|passwd|secret|apikey|api[_-]?key|authorization|cookie|databaseurl|db[_-]?url|privatekey|accesskey|auth|credential)/i;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.orch', 'coverage', '.next']);

function addValue(set: Set<string>, raw: string | undefined) {
  if (!raw) return;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!v || v.length < 6) return;
  set.add(v);
  try {
    const unescaped = v
      .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (unescaped !== v && unescaped.length >= 6) set.add(unescaped);
  } catch { /* ignore */ }
}

function parseEnvFile(p: string, out: Set<string>) {
  let text: string;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[1].trim();
    if (!(val.startsWith('"') || val.startsWith("'") || val.startsWith('`'))) {
      val = val.split(/\s+#/)[0]!.trim();
    }
    addValue(out, val);
  }
}

/** Recursively finds .env, .env.local, .env.* — skips example/sample/template. */
export function envValues(root: string): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        if (!(e.name === '.env' || e.name.startsWith('.env.'))) continue;
        if (/example|sample|template/i.test(e.name)) continue;
        parseEnvFile(full, out);
      }
    }
  };
  walk(root);
  return [...out].sort((a, b) => b.length - a.length);
}

function redactString(text: string, extra: string[] = []): string {
  let out = text;
  for (const v of extra) {
    if (!v) continue;
    out = out.split(v).join('[REDACTED:env-value]');
    try {
      const esc = JSON.stringify(v).slice(1, -1);
      if (esc !== v) out = out.split(esc).join('[REDACTED:env-value]');
    } catch { /* ignore */ }
  }
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out.replace(ASSIGNMENT, '$1$2[REDACTED:assignment]');
}

export function redact(text: string, extra: string[] = []): string {
  return redactString(text, extra);
}

/** Redact BEFORE JSON.stringify. Redacts sensitive keys regardless of value. */
export function redactDeep<T>(value: T, secrets: string[] = []): T {
  if (typeof value === 'string') return redactString(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        if (v && typeof v === 'object') out[k] = redactDeep(v, secrets);
        else out[k] = '[REDACTED:field]';
      } else {
        out[k] = redactDeep(v as unknown, secrets);
      }
    }
    return out as T;
  }
  return value;
}

export function detectSecrets(text: string): string[] {
  const hits: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) if (text.match(re)) hits.push(name);
  if (/\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?(?!\[REDACTED)[^\s"',;]{8,}/i.test(text)) hits.push('assignment');
  return hits;
}
