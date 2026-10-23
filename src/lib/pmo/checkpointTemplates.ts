// The fixed catalog of checkpoint templates a to-do can start from. The model
// only ever picks an id; the labels live here so they can't be invented.
import type { CheckpointTemplateId } from "./types.ts";

export interface CheckpointTemplateStep {
  label: string;
  kind: "step" | "approval";
}

export interface CheckpointTemplate {
  id: CheckpointTemplateId;
  label: string;
  hint: string;
  steps: readonly CheckpointTemplateStep[];
}

const step = (label: string): CheckpointTemplateStep => ({ label, kind: "step" });

export const CHECKPOINT_TEMPLATES: Record<CheckpointTemplateId, CheckpointTemplate> = {
  simple: {
    id: "simple",
    label: "Simple",
    hint: "A quick one-off task.",
    steps: [step("Acknowledged"), step("Done")],
  },
  deliverable: {
    id: "deliverable",
    label: "Deliverable",
    hint: "Something to produce and hand over (report, deck, plan).",
    steps: [
      step("Acknowledged"),
      step("Draft"),
      step("Internal review"),
      step("Delivered"),
      step("Closed"),
    ],
  },
  approval: {
    id: "approval",
    label: "Approval",
    hint: "Needs somebody's sign-off.",
    steps: [
      step("Draft"),
      step("Sent for sign-off"),
      // The sign-off step is flagged so a later phase can treat it specially
      // (reminders, escalation); nothing reads `kind` yet.
      { label: "Sign-off received", kind: "approval" },
      step("Closed"),
    ],
  },
  followup: {
    id: "followup",
    label: "Follow-up",
    hint: "Chasing or tracking something other people own.",
    steps: [step("Acknowledged"), step("Waiting on others"), step("Resolved")],
  },
};

export const CHECKPOINT_TEMPLATE_LIST = Object.values(CHECKPOINT_TEMPLATES);
