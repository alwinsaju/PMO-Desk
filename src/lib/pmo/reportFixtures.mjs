// Shared fictional data for the weekly-report tests (not a test file itself).
// "Now" is Saturday 24 Oct 2026, 12:00 IST; this week is Mon 19 - Sat 24 Oct.
import { PeriodRequestSchema, buildReport } from "./report.ts";
import { buildTodo, emptyDraft } from "./todoLogic.ts";
import { PmoConfigSchema } from "./types.ts";

export const config = PmoConfigSchema.parse({});
export const SAT = new Date("2026-10-24T06:30:00.000Z");

let seq = 0;
export function todo(patch = {}) {
  seq++;
  const base = buildTodo(
    {
      ...emptyDraft(patch.title ?? `Task ${seq}`),
      owner: { name: patch.ownerName ?? "Priya Nair", email: null, isMe: false },
    },
    {
      now: patch.createdAt ?? "2026-10-01T06:00:00.000Z",
      approvedBy: "tester",
      source: {
        intakeId: null,
        source: "manual",
        link: null,
        subject: "x",
        sender: null,
        receivedAt: null,
        threadKey: null,
      },
    },
  );
  const rest = { ...patch };
  delete rest.ownerName;
  return { ...base, id: `td_${String(seq).padStart(16, "0")}`, ...rest };
}

export const done = (when, patch = {}) =>
  todo({ status: "done", completedAt: when, updatedAt: when, ...patch });

export const request = (kind, extra = {}) =>
  PeriodRequestSchema.parse({ kind, ...extra });

export function build(todos, now = SAT, req = request("this-week"), cfg = config) {
  const result = buildReport(todos, now, req, cfg);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

/** A busy week: closed, overdue, waiting, due soon, new and a pending sign-off. */
export function sampleTodos() {
  const signOff = todo({
    title: "Steering committee pack",
    ownerName: "Alwin Saju",
    dueAt: "2026-10-27",
  });
  signOff.checkpoints = [
    { id: "cp_a", label: "Draft", kind: "step", state: "done" },
    { id: "cp_b", label: "Sign-off received", kind: "approval", state: "pending" },
  ];
  return [
    done("2026-10-21T05:00:00Z", {
      title: "Publish RAID log v3",
      ownerName: "Priya Nair",
    }),
    done("2026-10-23T09:00:00Z", {
      title: "Close Q3 vendor invoices",
      ownerName: "Sam Okafor",
    }),
    todo({
      title: "Resource plan for Phase 2",
      ownerName: "Alwin Saju",
      dueAt: "2026-10-19",
    }),
    todo({
      title: "Vendor security questionnaire",
      ownerName: "Alwin Saju",
      waitingOn: "Jordan Lee",
      waitingSince: "2026-10-19T04:00:00Z",
      dueAt: "2026-10-29",
    }),
    todo({
      title: "Draft communication plan",
      ownerName: "Sam Okafor",
      dueAt: "2026-10-28",
      createdAt: "2026-10-20T05:00:00Z",
    }),
    signOff,
    todo({
      title: "Onboard new analyst",
      ownerName: "Priya Nair",
      createdAt: "2026-10-22T05:00:00Z",
    }),
  ];
}
