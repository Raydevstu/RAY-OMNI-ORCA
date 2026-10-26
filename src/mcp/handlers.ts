import { z } from 'zod';
import { compileTask } from '../core/compiler.js';
import { classify } from '../core/gates.js';
import { saveTask, getTask, setTaskStatus } from '../core/tasks.js';
import { createPending, setConfirmation, getConfirmation, requireApproval, fingerprint } from '../core/confirmations.js';
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
    const fp = createPending(root, task.id, spec, blocking);
    setTaskStatus(root, task.id, 'needs_approval');
    new Recorder(root).record('confirmation_pending', { taskId: task.id, fingerprint: fp, gates: blocking });
    return {
      taskId: task.id, status: 'needs_approval',
      fingerprint: fp, gates: blocking, spec,
      message: `Gated areas (${blocking.join(', ')}) require approval. Call decide_confirmation with approve=true.`,
    };
  }

  setTaskStatus(root, task.id, 'executable');
  return { taskId: task.id, status: 'executable', spec, gates };
}

export async function request_confirmation(root: string, input: z.infer<typeof RequestConfInput>) {
  const t = getTask(root, input.taskId);
  if (!t) throw new Error(`unknown task ${input.taskId}`);
  if (t.status === 'needs_clarification') throw new Error('task needs clarification first');

  const c = input.gates?.length ? { reasons: input.gates.map(g => ({ gate: g })) } : classify({ text: JSON.stringify(input.action) });
  const gates: string[] = [...new Set((c.reasons as Array<{ gate: string }>).map(r => r.gate))];
  const fp = createPending(root, input.taskId, input.action, gates);
  new Recorder(root).record('confirmation_pending', { taskId: input.taskId, fingerprint: fp, gates });
  return { fingerprint: fp, status: 'pending', gates };
}

export async function decide_confirmation(root: string, input: z.infer<typeof DecideConfInput>) {
  const row = getConfirmation(root, input.fingerprint);
  if (!row) throw new Error(`unknown confirmation ${input.fingerprint}`);
  setConfirmation(root, input.fingerprint, input.approve ? 'approved' : 'denied');
  if (input.approve) {
    try { setTaskStatus(root, row.taskId, 'executable'); } catch { /* ignore */ }
  }
  new Recorder(root).record('confirmation_decided', { fingerprint: input.fingerprint, approved: input.approve });
  return { fingerprint: input.fingerprint, status: input.approve ? 'approved' : 'denied' };
}

export async function execute_gated_action<T>(root: string, taskId: string, action: unknown, fn: () => Promise<T> | T) {
  const t = getTask(root, taskId);
  if (!t) throw new Error(`unknown task ${taskId}`);
  if (t.status === 'needs_clarification') throw new Error('GATED: task needs clarification');
  requireApproval(root, taskId, action);
  const out = await fn();
  new Recorder(root).record('gated_executed', { taskId, fingerprint: fingerprint(taskId, action, envValues(root)) });
  return out;
}
