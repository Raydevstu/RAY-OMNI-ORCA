import { createHash } from 'node:crypto';
import { openStore } from './store.js';
import { envValues, redact, redactDeep } from './redact.js';

export type GateStatus = 'pending' | 'approved' | 'denied';

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort().map(k => [k, stable((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

export function fingerprint(taskId: string, action: unknown, secrets: string[] = []): string {
  const safe = redactDeep(stable(action), secrets);
  return createHash('sha256').update(taskId + ':' + JSON.stringify(safe)).digest('hex').slice(0, 16);
}

export type ConfirmKind = 'plan' | 'action';

function kinded(kind: ConfirmKind, action: unknown): unknown {
  return { kind, action: stable(action) };
}

export function createPending(root: string, taskId: string, action: unknown, gates: string[], kind: ConfirmKind = 'action') {
  const secrets = envValues(root);
  const fp = fingerprint(taskId, kinded(kind, action), secrets);
  const db = openStore(root);
  const existing = db.prepare('SELECT status FROM confirmations WHERE fingerprint=?').get(fp) as unknown as { status: string } | undefined;
  if (existing) {
    if (existing.status === 'denied') throw new Error(`GATED: ${fp} was previously denied — requires a new action`);
    return fp; // idempotent for pending/approved
  }
  const safeAction = redactDeep(stable(action), secrets);
  db.prepare(
    'INSERT INTO confirmations(fingerprint,taskId,gates,status,createdAt) VALUES(?,?,?,?,?)'
  ).run(fp, taskId, JSON.stringify({ gates, kind, action: safeAction }), 'pending', new Date().toISOString());
  return fp;
}

/** Terminal transition: only a pending request can be decided. Denied/approved can never flip. */
export function decide(root: string, fp: string, approve: boolean): GateStatus {
  const r = openStore(root).prepare(
    "UPDATE confirmations SET status=?, approvedAt=? WHERE fingerprint=? AND status='pending'"
  ).run(approve ? 'approved' : 'denied', approve ? new Date().toISOString() : null, fp);
  if (Number(r.changes) === 1) return approve ? 'approved' : 'denied';
  const row = getConfirmation(root, fp);
  if (!row) throw new Error(`unknown confirmation ${fp}`);
  throw new Error(`GATED: confirmation ${fp} is ${row.status} (terminal) — requires a new request_confirmation`);
}

export function getConfirmation(root: string, fp: string) {
  return openStore(root).prepare(
    'SELECT * FROM confirmations WHERE fingerprint=?'
  ).get(fp) as unknown as { fingerprint: string; taskId: string; gates: string; status: string } | undefined;
}

export function requireApproval(root: string, taskId: string, action: unknown, kind: ConfirmKind = 'action'): void {
  const fp = fingerprint(taskId, kinded(kind, action), envValues(root));
  const row = getConfirmation(root, fp);
  if (!row || row.status !== 'approved') {
    throw new Error(`GATED: confirmation ${fp} not approved. Call request_confirmation first.`);
  }
}

export interface EditAction { file: string; contentSha256: string }

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Canonical edit action: approvals bind to file path + content digest, never byte length. */
export function normalizeAction(action: unknown): EditAction {
  const a = action as Record<string, unknown> | null;
  if (!a || typeof a.file !== 'string' || !a.file) throw new Error('action must include file');
  if (typeof a.content === 'string') return { file: a.file, contentSha256: sha256(a.content) };
  if (typeof a.contentSha256 === 'string' && a.contentSha256) return { file: a.file, contentSha256: a.contentSha256 };
  throw new Error('action must include content or contentSha256');
}

export function isEditAction(action: unknown): boolean {
  const a = action as Record<string, unknown> | null;
  return !!a && typeof a.file === 'string' && (typeof a.content === 'string' || typeof a.contentSha256 === 'string');
}

/** Redacted human-review preview of proposed content (first lines only, secrets masked). */
export function previewContent(root: string, content: string, maxLines = 20, maxChars = 1500): string {
  const head = content.split('\n').slice(0, maxLines).join('\n').slice(0, maxChars);
  return redact(head, envValues(root));
}

/** Approved edit actions for a task (parsed from stored confirmation rows). */
export function approvedActions(root: string, taskId: string): EditAction[] {
  const rows = openStore(root).prepare(
    "SELECT gates FROM confirmations WHERE taskId=? AND status='approved'"
  ).all(taskId) as unknown as Array<{ gates: string }>;
  const out: EditAction[] = [];
  for (const r of rows) {
    try {
      const a = (JSON.parse(r.gates) as { action?: unknown })?.action;
      if (a && typeof (a as EditAction).file === 'string' && typeof (a as EditAction).contentSha256 === 'string') {
        out.push(a as EditAction);
      }
    } catch { /* ignore malformed rows */ }
  }
  return out;
}
