import { createHash } from 'node:crypto';
import { openStore } from './store.js';
import { envValues, redactDeep } from './redact.js';

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

export function setConfirmation(root: string, fp: string, status: GateStatus) {
  openStore(root).prepare(
    'UPDATE confirmations SET status=?, approvedAt=? WHERE fingerprint=?'
  ).run(status, status === 'approved' ? new Date().toISOString() : null, fp);
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
