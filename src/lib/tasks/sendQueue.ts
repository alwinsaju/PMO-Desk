/** The send-later queue. A person approves a send at queue time, together with the recipients they saw; the app sends it
 *  at the chosen time only while it is running, and holds it if the recipients have changed. Pure. */
import type { Recipients } from "./recipientCheck.ts";
import { sameRecipients } from "./recipientCheck.ts";

export interface QueuedSend {
  id: string;
  taskId: string;
  taskName: string;
  /** ISO instant to send at. */
  at: string;
  queuedAt: string;
  subject: string;
  recipients: Recipients;
}

/** How long after its time a queued send may still go by itself; later than this it waits for a person. */
export const GRACE_MS = 15 * 60_000;

export type SendDecision = "wait" | "send" | "overdue";

export function decide(item: QueuedSend, now: Date): SendDecision {
  const late = now.getTime() - Date.parse(item.at);
  if (!Number.isFinite(late) || late < 0) return "wait";
  return late <= GRACE_MS ? "send" : "overdue";
}

export type Gate = { ok: true } | { ok: false; reason: string };

/** Is the task still where the person approved it, with the same recipients? */
export function canDispatch(
  item: QueuedSend,
  taskState: string | undefined,
  current: Recipients | null,
): Gate {
  if (taskState !== "awaiting_send")
    return { ok: false, reason: "The task is no longer waiting to be sent." };
  if (!current) return { ok: false, reason: "The draft's recipients could not be read." };
  if (!sameRecipients(item.recipients, current))
    return { ok: false, reason: "The recipients changed after you queued it." };
  return { ok: true };
}

export function enqueue(queue: readonly QueuedSend[], item: QueuedSend): QueuedSend[] {
  return [...queue.filter((q) => q.taskId !== item.taskId), item];
}

export const dequeue = (queue: readonly QueuedSend[], id: string): QueuedSend[] =>
  queue.filter((q) => q.id !== id);

/** The instant for a "send at" choice. `hour` is the local hour; a time already past means tomorrow. */
export function nextAt(now: Date, hour: number, minute = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export function sanitizeQueue(value: unknown): QueuedSend[] {
  if (!Array.isArray(value)) return [];
  const out: QueuedSend[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const rec = r.recipients as Record<string, unknown> | undefined;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
    if (
      typeof r.id !== "string" ||
      typeof r.taskId !== "string" ||
      typeof r.at !== "string" ||
      Number.isNaN(Date.parse(r.at)) ||
      !rec
    )
      continue;
    out.push({
      id: r.id,
      taskId: r.taskId,
      taskName: typeof r.taskName === "string" ? r.taskName : r.taskId,
      at: r.at,
      queuedAt: typeof r.queuedAt === "string" ? r.queuedAt : r.at,
      subject: typeof r.subject === "string" ? r.subject.slice(0, 300) : "",
      recipients: { to: list(rec.to), cc: list(rec.cc) },
    });
  }
  return out.slice(0, 50);
}
