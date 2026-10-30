// Pure rules for proposals and to-dos: drafts, building a Todo from an
// approved draft, the derived stage/progress, and patch application. Shared
// by the server (which persists) and the UI (which displays), so it imports
// nothing from node.
import { z } from "zod";
import { CHECKPOINT_TEMPLATES } from "./checkpointTemplates.ts";
import type {
  ActionItem,
  AiStructured,
  Checkpoint,
  HistoryEntry,
  HistoryKind,
  Proposal,
  Todo,
  TodoDraft,
  TodoSource,
} from "./types.ts";
import { MAX_CHASER_DAYS, MAX_HISTORY, PRIORITIES, TodoStatusSchema } from "./types.ts";
import { isRealIsoDay, isRealIsoInstant } from "./time.ts";

export function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function emptyDraft(title = ""): TodoDraft {
  return {
    title,
    description: "",
    owner: { name: null, email: null, isMe: null },
    requester: { name: null, email: null },
    dueAt: null,
    priority: "normal",
    actionItems: [],
    checkpointTemplate: "simple",
    waitingOn: null,
    tags: [],
    recurrence: null,
  };
}

/** The editable draft the model's output starts out as. */
export function draftFromAi(ai: AiStructured, fallbackTitle = ""): TodoDraft {
  return {
    title: ai.title || fallbackTitle,
    description: ai.description,
    owner: ai.owner,
    requester: ai.requester,
    // A date the model labels "none" is noise, not a due date.
    dueAt: ai.dueBasis === "none" ? null : ai.dueAt,
    priority: ai.priority,
    actionItems: ai.actionItems.map((item) => ({ ...item })),
    checkpointTemplate: ai.checkpointTemplate,
    waitingOn: ai.waitingOn,
    tags: ai.tags,
    recurrence: ai.recurrence,
  };
}

/** What the review form shows first: staged edits, else the AI draft, else a
 *  blank draft titled from the message subject. */
export function effectiveDraft(proposal: Proposal): TodoDraft {
  if (proposal.edits) return proposal.edits;
  if (proposal.draft) return draftFromAi(proposal.draft, proposal.summary.subject);
  return emptyDraft(proposal.summary.subject);
}

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export function buildCheckpoints(
  templateId: TodoDraft["checkpointTemplate"],
): Checkpoint[] {
  return CHECKPOINT_TEMPLATES[templateId].steps.map((step) => ({
    id: newId("cp"),
    label: step.label,
    kind: step.kind,
    state: "pending" as const,
  }));
}

// ---------------------------------------------------------------------------
// History (the timeline)
// ---------------------------------------------------------------------------

export function historyEntry(
  kind: HistoryKind,
  text: string,
  at: string,
  link: { intakeId?: string | null; from?: string | null } = {},
): HistoryEntry {
  return {
    id: newId("hs"),
    at,
    kind,
    text,
    intakeId: link.intakeId ?? null,
    from: link.from ?? null,
  };
}

/** Appends and keeps the list within MAX_HISTORY: the first entry (where the
 *  to-do came from) always stays, the oldest of the rest go. */
export function appendHistory(
  history: readonly HistoryEntry[],
  ...entries: HistoryEntry[]
): HistoryEntry[] {
  const all = [...history, ...entries];
  return all.length <= MAX_HISTORY
    ? all
    : [all[0], ...all.slice(all.length - (MAX_HISTORY - 1))];
}

export interface BuildTodoContext {
  now: string;
  approvedBy: string;
  source: TodoSource;
  /** Fixed id (derived from the proposal) so a repeated approve finds its to-do. */
  id?: string;
}

const trimToNull = (value: string | null | undefined): string | null =>
  value?.trim() || null;

export function buildTodo(draft: TodoDraft, context: BuildTodoContext): Todo {
  const waitingOn = trimToNull(draft.waitingOn);
  const { source } = context;
  return {
    id: context.id ?? newId("td"),
    title: draft.title.trim(),
    description: draft.description.trim(),
    owner: draft.owner,
    requester: draft.requester,
    dueAt: draft.dueAt,
    priority: draft.priority,
    actionItems: draft.actionItems.map((item): ActionItem => ({
      id: newId("ai"),
      text: item.text.trim(),
      done: false,
      owner: item.owner,
      dueAt: item.dueAt,
    })),
    checkpoints: buildCheckpoints(draft.checkpointTemplate),
    status: "open",
    waitingOn,
    // Since the approval, unless the draft says when the waiting really began.
    waitingSince: waitingOn ? (draft.waitingSince ?? context.now) : null,
    chaserDays: null,
    tags: draft.tags,
    blockedBy: [],
    recurrence: trimToNull(draft.recurrence),
    source,
    // Phase 1 sends no notifications; the shape is here so a later phase
    // doesn't need a migration.
    reminders: {
      enabled: false,
      remindAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
    },
    createdAt: context.now,
    approvedAt: context.now,
    approvedBy: context.approvedBy,
    updatedAt: context.now,
    completedAt: null,
    history: [
      historyEntry(
        "created",
        source.intakeId
          ? `Created from ${source.source === "teams" ? "a Teams message" : source.source === "outlook" ? "an email" : "a pasted message"}${source.subject ? `: ${source.subject}` : ""}.`
          : "Created by hand.",
        context.now,
        { intakeId: source.intakeId, from: source.sender },
      ),
      ...(waitingOn
        ? [historyEntry("waiting", `Waiting on ${waitingOn}.`, context.now)]
        : []),
    ],
  };
}

const complete = (checkpoint: Checkpoint) => checkpoint.state !== "pending";

/** Label of the first checkpoint that isn't done or skipped; derived on every
 *  read, never stored. null = nothing left (or no checkpoints). */
export function deriveStage(todo: Pick<Todo, "checkpoints">): string | null {
  return todo.checkpoints.find((checkpoint) => !complete(checkpoint))?.label ?? null;
}

export function checkpointProgress(todo: Pick<Todo, "checkpoints">): {
  done: number;
  total: number;
} {
  return {
    done: todo.checkpoints.filter(complete).length,
    total: todo.checkpoints.length,
  };
}

export function allCheckpointsComplete(
  todo: Pick<Todo, "checkpoints" | "status">,
): boolean {
  return (
    todo.status === "open" &&
    todo.checkpoints.length > 0 &&
    todo.checkpoints.every(complete)
  );
}

export function isOverdue(todo: Pick<Todo, "dueAt" | "status">, today: string): boolean {
  return todo.status === "open" && todo.dueAt !== null && todo.dueAt < today;
}

// ---------------------------------------------------------------------------
// Patching
// ---------------------------------------------------------------------------

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDay, {
    message: "Not a real calendar date (for example 2026-02-30 does not exist).",
  });

/** Bounds on what a person can pile onto one to-do. */
export const MAX_ACTION_ITEMS = 50;
export const MAX_CHECKPOINTS = 20;

const actionOwner = z.string().trim().max(120).nullable();

export const TodoPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  owner: z
    .object({
      name: z.string().nullable(),
      email: z.string().nullable(),
      isMe: z.boolean().nullable(),
    })
    .optional(),
  requester: z
    .object({ name: z.string().nullable(), email: z.string().nullable() })
    .optional(),
  dueAt: isoDay.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  waitingOn: z.string().max(200).nullable().optional(),
  /** When the waiting began (ISO); defaults to now when `waitingOn` is set. */
  waitingSince: z
    .string()
    .refine(isRealIsoInstant, {
      message: "waitingSince must be an ISO 8601 date-time on a real calendar day",
    })
    .nullable()
    .optional(),
  /** Chase after this many quiet working days; null = the global default. */
  chaserDays: z.number().int().min(1).max(MAX_CHASER_DAYS).nullable().optional(),
  tags: z.array(z.string()).max(10).optional(),
  /** The to-dos this one waits for (replaces the list; itself is ignored). */
  blockedBy: z.array(z.string()).max(10).optional(),
  status: TodoStatusSchema.optional(),
  /** Silence this to-do's reminders until this instant (ISO); null un-snoozes. */
  snoozedUntil: z
    .string()
    .refine(isRealIsoInstant, {
      message: "snoozedUntil must be an ISO 8601 date-time on a real calendar day",
    })
    .nullable()
    .optional(),
  /** Check / uncheck existing action items. */
  actionItems: z.array(z.object({ id: z.string(), done: z.boolean() })).optional(),
  addActionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        owner: actionOwner.optional(),
        dueAt: isoDay.nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  /** Change the text, owner or due date of existing action items. */
  editActionItems: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().trim().min(1).max(200).optional(),
        owner: actionOwner.optional(),
        dueAt: isoDay.nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  removeActionItemIds: z.array(z.string()).optional(),
  /** Mark checkpoints done / skipped / pending again. */
  checkpoints: z
    .array(z.object({ id: z.string(), state: z.enum(["pending", "done", "skipped"]) }))
    .optional(),
  /** New checkpoints, appended unless `at` (a 0-based position) is given. */
  addCheckpoints: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        kind: z.enum(["step", "approval"]).optional(),
        at: z.number().int().min(0).optional(),
      }),
    )
    .max(10)
    .optional(),
  renameCheckpoints: z
    .array(z.object({ id: z.string(), label: z.string().trim().min(1).max(80) }))
    .max(MAX_CHECKPOINTS)
    .optional(),
  removeCheckpointIds: z.array(z.string()).optional(),
  /** The full new order of checkpoint ids (ids left out keep their relative
   *  order after the listed ones; unknown ids are ignored). */
  checkpointOrder: z.array(z.string()).max(MAX_CHECKPOINTS).optional(),
});
export type TodoPatch = z.infer<typeof TodoPatchSchema>;

export interface PatchResult {
  todo: Todo;
  /** Every checkpoint is now done/skipped but the to-do is still open: the UI
   *  asks the human whether to mark it done. Never done automatically. */
  offerDone: boolean;
  /** For the audit log. */
  kinds: Array<
    "edit" | "complete" | "cancel" | "reopen" | "progress" | "snooze" | "waiting"
  >;
}

const FIELD_KEYS = [
  "title",
  "description",
  "owner",
  "requester",
  "dueAt",
  "priority",
  "waitingOn",
  "waitingSince",
  "chaserDays",
  "tags",
  "blockedBy",
  "editActionItems",
  "removeActionItemIds",
  "addCheckpoints",
  "renameCheckpoints",
  "removeCheckpointIds",
  "checkpointOrder",
] as const;

/** Null when the to-do is within bounds, else what is too long. */
export function todoLimitProblem(
  todo: Pick<Todo, "actionItems" | "checkpoints">,
): string | null {
  if (todo.actionItems.length > MAX_ACTION_ITEMS)
    return `A to-do can have at most ${MAX_ACTION_ITEMS} action items.`;
  if (todo.checkpoints.length > MAX_CHECKPOINTS)
    return `A to-do can have at most ${MAX_CHECKPOINTS} checkpoints.`;
  return null;
}

export function applyTodoPatch(todo: Todo, patch: TodoPatch, now: string): PatchResult {
  const next: Todo = { ...todo, updatedAt: now };
  const kinds: PatchResult["kinds"] = [];

  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.owner !== undefined) next.owner = patch.owner;
  if (patch.requester !== undefined) next.requester = patch.requester;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
  if (patch.priority !== undefined) next.priority = patch.priority;
  let history = todo.history ?? [];
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.blockedBy !== undefined) {
    next.blockedBy = [...new Set(patch.blockedBy)].filter((id) => id !== todo.id);
  }
  if (patch.chaserDays !== undefined) next.chaserDays = patch.chaserDays;
  if (patch.waitingOn !== undefined) {
    const before = trimToNull(todo.waitingOn);
    const after = trimToNull(patch.waitingOn);
    next.waitingOn = after;
    if (after === null) {
      next.waitingSince = null;
    } else if (after !== before) {
      // Newly waiting (or waiting on someone else): the clock starts now,
      // unless the caller says when it really began.
      next.waitingSince = patch.waitingSince ?? now;
    } else if (patch.waitingSince !== undefined) {
      next.waitingSince = patch.waitingSince ?? todo.waitingSince ?? now;
    }
    if (after !== before) {
      kinds.push("waiting");
      history = appendHistory(
        history,
        historyEntry(
          "waiting",
          after
            ? `Waiting on ${after}.`
            : `Got a reply / no longer waiting${before ? ` (was waiting on ${before})` : ""}.`,
          now,
        ),
      );
    }
  } else if (patch.waitingSince !== undefined && trimToNull(todo.waitingOn)) {
    next.waitingSince = patch.waitingSince ?? now;
  }
  if (patch.dueAt !== undefined && patch.dueAt !== todo.dueAt) {
    history = appendHistory(
      history,
      historyEntry(
        "due",
        `Due date ${todo.dueAt ?? "(none)"} → ${patch.dueAt ?? "(none)"}.`,
        now,
      ),
    );
  }
  if (FIELD_KEYS.some((key) => patch[key] !== undefined)) kinds.push("edit");

  let items = next.actionItems;
  if (patch.removeActionItemIds?.length) {
    const drop = new Set(patch.removeActionItemIds);
    items = items.filter((item) => !drop.has(item.id));
  }
  if (patch.editActionItems?.length) {
    const edits = new Map(patch.editActionItems.map((edit) => [edit.id, edit]));
    items = items.map((item) => {
      const edit = edits.get(item.id);
      if (!edit) return item;
      return {
        ...item,
        text: edit.text ?? item.text,
        owner: edit.owner === undefined ? item.owner : edit.owner || null,
        dueAt: edit.dueAt === undefined ? item.dueAt : edit.dueAt,
      };
    });
  }
  if (patch.addActionItems?.length) {
    items = [
      ...items,
      ...patch.addActionItems.map((item): ActionItem => ({
        id: newId("ai"),
        text: item.text,
        done: false,
        owner: item.owner || null,
        dueAt: item.dueAt ?? null,
      })),
    ];
  }
  if (patch.actionItems?.length) {
    const wanted = new Map(patch.actionItems.map((item) => [item.id, item.done]));
    items = items.map((item) => {
      const done = wanted.get(item.id);
      return done === undefined || done === item.done ? item : { ...item, done };
    });
    kinds.push("progress");
  }
  next.actionItems = items;

  let checkpoints = next.checkpoints;
  if (patch.removeCheckpointIds?.length) {
    const drop = new Set(patch.removeCheckpointIds);
    checkpoints = checkpoints.filter((checkpoint) => !drop.has(checkpoint.id));
  }
  if (patch.renameCheckpoints?.length) {
    const labels = new Map(patch.renameCheckpoints.map((c) => [c.id, c.label]));
    checkpoints = checkpoints.map((checkpoint) => {
      const label = labels.get(checkpoint.id);
      return label === undefined ? checkpoint : { ...checkpoint, label };
    });
  }
  for (const added of patch.addCheckpoints ?? []) {
    const created: Checkpoint = {
      id: newId("cp"),
      label: added.label,
      kind: added.kind ?? "step",
      state: "pending",
    };
    const at = Math.min(added.at ?? checkpoints.length, checkpoints.length);
    checkpoints = [...checkpoints.slice(0, at), created, ...checkpoints.slice(at)];
  }
  if (patch.checkpointOrder?.length) {
    const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const ordered: Checkpoint[] = [];
    for (const id of patch.checkpointOrder) {
      const checkpoint = byId.get(id);
      if (checkpoint) {
        ordered.push(checkpoint);
        byId.delete(id);
      }
    }
    checkpoints = [...ordered, ...checkpoints.filter((c) => byId.has(c.id))];
  }
  if (patch.checkpoints?.length) {
    const wanted = new Map(patch.checkpoints.map((c) => [c.id, c.state]));
    checkpoints = checkpoints.map((checkpoint) => {
      const state = wanted.get(checkpoint.id);
      if (state === undefined || state === checkpoint.state) return checkpoint;
      return { ...checkpoint, state, doneAt: state === "pending" ? null : now };
    });
    kinds.push("progress");
  }
  next.checkpoints = checkpoints;

  if (patch.snoozedUntil !== undefined) {
    next.reminders = { ...next.reminders, snoozedUntil: patch.snoozedUntil };
    kinds.push("snooze");
  }

  if (patch.status !== undefined && patch.status !== next.status) {
    next.status = patch.status;
    next.completedAt = patch.status === "done" ? now : null;
    kinds.push(
      patch.status === "done"
        ? "complete"
        : patch.status === "cancelled"
          ? "cancel"
          : "reopen",
    );
    history = appendHistory(
      history,
      historyEntry(
        "status",
        patch.status === "done"
          ? "Marked done."
          : patch.status === "cancelled"
            ? "Cancelled."
            : "Reopened.",
        now,
      ),
    );
  }
  next.history = history;

  // A snooze alone is not "an update": it must not restart the chaser clock
  // (the working days a to-do has gone quiet), so keep the old timestamp.
  if (kinds.length > 0 && kinds.every((kind) => kind === "snooze")) {
    next.updatedAt = todo.updatedAt;
  }

  return { todo: next, offerDone: allCheckpointsComplete(next), kinds };
}
