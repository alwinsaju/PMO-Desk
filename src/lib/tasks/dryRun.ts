/** "What will happen" for a task, in plain steps, before the first step runs. Built from the task's own manifest. Pure. */
import type { InputStatus, Task } from "@/components/apps/tasks-app/types";
import { plainStepName } from "./runHistory.ts";

export interface DryRunLine {
  text: string;
  kind: "auto" | "you" | "outside";
}

export interface DryRun {
  reads: string[];
  lines: DryRunLine[];
  /** True when something leaves this computer if you confirm (a send step exists). */
  sends: boolean;
  /** Reassurance or warning, one sentence. */
  note: string;
}

const isSend = (id: string, type: string) => /(^|_)send(_|$)/.test(id) && type !== "confirm";

export function dryRunPlan(
  task: Pick<Task, "steps" | "inputs">,
  statuses: readonly InputStatus[],
): DryRun {
  const reads = (task.inputs ?? [])
    .filter((i) => i.type === "file")
    .map((i) => {
      const s = statuses.find((x) => x.id === i.id);
      const state = s?.present ? (s.filename ?? "uploaded") : i.required ? "NOT uploaded yet" : "not provided";
      return `${i.label}: ${state}`;
    });
  const lines: DryRunLine[] = task.steps.map((step) => {
    const name = plainStepName({ steps: task.steps }, step.id);
    if (step.type === "review") return { text: name, kind: "you" };
    if (step.type === "confirm") return { text: name, kind: "you" };
    if (isSend(step.id, step.type)) return { text: name, kind: "outside" };
    return { text: name, kind: "auto" };
  });
  const sends = lines.some((l) => l.kind === "outside");
  const draft = task.steps.some((s) => /create_draft/.test(s.id));
  const note = sends
    ? "Nothing is sent until you confirm it at the send step."
    : draft
      ? "It creates a draft for you to review. Nothing is sent."
      : "Nothing is sent by this task.";
  return { reads, lines, sends, note };
}
