import { z } from 'zod';
import { compileTask } from '../core/compiler.js';
import { classify } from '../core/gates.js';
import { saveTask, getTask, setTaskStatus, setTaskExecution } from '../core/tasks.js';
import { createPending, decide, requireApproval, fingerprint, normalizeAction, isEditAction, previewContent } from '../core/confirmations.js';
import { createCheckpoint } from '../core/checkpoint.js';
import { Recorder } from '../core/recorder.js';
import { envValues } from '../core/redact.js';
import { loadProjectMap } from '../core/indexer.js';

const BLOCKING = new Set(['delete', 'migration', 'auth', 'payment', 'secret', 'dependency', 'deletion', 'migrations', 'secrets', 'deps', 'exec']);

export const StartTaskInput = z.object({ prompt: z.string().min(1) });
export const RequestConfInput = z.object({ taskId: z.string(), action: z.unknown(), gates: z.array(z.string()).optional() });
export const DecideConfInput = z.object({ fingerprint: z.string(), approve: z.boolean() });

export async function start_task(root: string, input: z.infer<typeof StartTaskInput>) {
  const map = loadProjectMap(root);
  const spec = compileTask(input.prompt, map);
  const task = saveTask(root, input.prompt, spec);

  if (spec.status === 'needs_clarification') {
    setTaskStatus(root, task.id, 'needs_clarification');
    new Recorder(root).record('task_blocked', { taskId: task.id, reason: 'needs_clarification' });
    return { taskId: task.id, status: 'needs_clarification', questions: spec.questions, spec };
  }

  const c = classify({ text: input.prompt });
  const gates: string[] = [...new Set(c.reasons.map(r => r.gate))];
  const blocking = gates.filter(g => BLOCKING.has(g));

  if (blocking.length > 0) {
    // Gates identified only — no confirmation record is created here.
    // Each concrete file/command needs its own request_confirmation + begin_execution.
    setTaskStatus(root, task.id, 'needs_approval');
    new Recorder(root).record('gates_identified', { taskId: task.id, gates: blocking });
    return {
      taskId: task.id, status: 'needs_approval', gates: blocking,
      message: `Gated areas (${blocking.join(', ')}) require approval. Call request_confirmation for EACH concrete file/command, then begin_execution.`,
    };
  }

  setTaskStatus(root, task.id, 'executable');
  return { taskId: task.id, status: 'executable', spec, gates };
}

export async function request_confirmation(root: string, input: z.infer<typeof RequestConfInput>) {
  const t = getTask(root, input.taskId);
  if (!t) throw new Error(`unknown task ${input.taskId}`);
  if (t.status === 'needs_clarification') throw new Error('task needs clarification first');

  // Caller gates can only add, never suppress auto-detected gates.
  const detected: string[] = classify({ text: JSON.stringify(input.action) }).reasons.map(r => r.gate);
  const gates: string[] = [...new Set([...detected, ...(input.gates ?? [])])];
  // Edit actions are canonicalized to {file, contentSha256} before approval is recorded,
  // so the approval binds to the exact content, not its length.
  const stored = isEditAction(input.action) ? normalizeAction(input.action) : input.action;
  const fp = createPending(root, input.taskId, stored, gates, 'action');
  new Recorder(root).record('confirmation_pending', { taskId: input.taskId, fingerprint: fp, gates });
  if (isEditAction(input.action)) {
    const norm = normalizeAction(input.action);
    const raw = (input.action as { content?: unknown }).content;
    return { fingerprint: fp, status: 'pending', gates, file: norm.file, contentSha256: norm.contentSha256,
      preview: typeof raw === 'string' ? previewContent(root, raw) : undefined };
  }
  return { fingerprint: fp, status: 'pending', gates };
}

export async function decide_confirmation(root: string, input: z.infer<typeof DecideConfInput>) {
  const status = decide(root, input.fingerprint, input.approve);
  // Deliberately does NOT mark the task executable: only begin_execution does,
  // after verifying approval AND creating a checkpoint atomically.
  new Recorder(root).record('confirmation_decided', { fingerprint: input.fingerprint, approved: input.approve });
  return { fingerprint: input.fingerprint, status };
}

export const BeginExecutionInput = z.object({ taskId: z.string(), action: z.unknown() });

/** The ONLY path to rollback protection: verifies approval, checkpoints, binds execution. */
export async function begin_execution(root: string, input: z.infer<typeof BeginExecutionInput>) {
  const t = getTask(root, input.taskId);
  if (!t) throw new Error(`unknown task ${input.taskId}`);
  const stored = isEditAction(input.action) ? normalizeAction(input.action) : input.action;
  requireApproval(root, input.taskId, stored, 'action');
  const checkpoint = createCheckpoint(root, input.taskId);
  const fp = fingerprint(input.taskId, { kind: 'action', action: stored }, envValues(root));
  setTaskExecution(root, input.taskId, fp);
  new Recorder(root).record('execution_started', { taskId: input.taskId, checkpoint, fingerprint: fp });
  return { taskId: input.taskId, checkpoint, status: 'executing' };
}

/** Require the task to be in the bound executing state for this exact action. */
export function requireExecution(root: string, taskId: string, action: unknown): void {
  const t = getTask(root, taskId);
  if (!t) throw new Error(`unknown task ${taskId}`);
  const stored = isEditAction(action) ? normalizeAction(action) : action;
  const fp = fingerprint(taskId, { kind: 'action', action: stored }, envValues(root));
  if (t.status !== 'executing' || t.execution !== fp) {
    throw new Error('GATED: begin_execution has not authorized this exact action. Call begin_execution first.');
  }
}

export async function execute_gated_action<T>(root: string, taskId: string, action: unknown, fn: () => Promise<T> | T) {
  const t = getTask(root, taskId);
  if (!t) throw new Error(`unknown task ${taskId}`);
  if (t.status === 'needs_clarification') throw new Error('GATED: task needs clarification');
  const stored = isEditAction(action) ? normalizeAction(action) : action;
  requireApproval(root, taskId, stored, 'action');
  const out = await fn();
  new Recorder(root).record('gated_executed', { taskId, fingerprint: fingerprint(taskId, { kind: 'action', action: stored }, envValues(root)) });
  return out;
}
