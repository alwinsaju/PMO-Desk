"use client";

import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "@phosphor-icons/react";
import { Button, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TodoPatch } from "@/lib/pmo/todoLogic";
import { signoffOf } from "@/lib/pmo/signoff";
import type { ActionItem, Checkpoint, ReminderPrefs, Todo } from "@/lib/pmo/types";
import { SignoffPanel } from "./SignoffPanel";

/** Sends one PATCH; resolves true when the server accepted it. */
export type ApplyPatch = (patch: TodoPatch) => Promise<boolean>;

interface EditorProps {
  todo: Todo;
  /** Closed to-dos are read-only until reopened. */
  open: boolean;
  busy: boolean;
  apply: ApplyPatch;
}

const inputClass = "text-[13px]";

// ---------------------------------------------------------------------------
// Action items: text, optional owner and due date, done, remove
// ---------------------------------------------------------------------------

export function ActionItemsEditor({ todo, open, busy, apply }: EditorProps) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [dueAt, setDueAt] = useState("");

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const added = await apply({
      addActionItems: [
        {
          text: text.trim(),
          owner: owner.trim() || null,
          dueAt: dueAt || null,
        },
      ],
    });
    if (added) {
      setText("");
      setOwner("");
      setDueAt("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {todo.actionItems.length === 0 && (
        <p className="text-ink-muted text-[13.5px]">No action items yet.</p>
      )}
      <ul className="flex flex-col gap-2">
        {todo.actionItems.map((item) => (
          <ActionItemRow
            key={item.id}
            item={item}
            open={open}
            busy={busy}
            apply={apply}
          />
        ))}
      </ul>
      {open && (
        <form
          className="border-line flex flex-wrap items-center gap-2 border-t pt-3.5"
          onSubmit={(event) => void add(event)}
        >
          <Input
            value={text}
            placeholder="Add an action item"
            aria-label="New action item"
            onChange={(e) => setText(e.target.value)}
            className={cn(inputClass, "min-w-48 flex-1")}
          />
          <Input
            value={owner}
            placeholder="Owner (optional)"
            aria-label="New action item owner"
            onChange={(e) => setOwner(e.target.value)}
            className={cn(inputClass, "w-36")}
          />
          <Input
            type="date"
            value={dueAt}
            aria-label="New action item due date"
            onChange={(e) => setDueAt(e.target.value)}
            className={cn(inputClass, "w-36")}
          />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={busy || !text.trim()}
          >
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

function ActionItemRow({
  item,
  open,
  busy,
  apply,
}: {
  item: ActionItem;
  open: boolean;
  busy: boolean;
  apply: ApplyPatch;
}) {
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [dueAt, setDueAt] = useState(item.dueAt ?? "");
  // Follow the saved values when they change underneath us (another edit, a
  // reload) but never on a poll that returns what we already have.
  const [saved, setSaved] = useState({
    text: item.text,
    owner: item.owner ?? "",
    dueAt: item.dueAt ?? "",
  });
  if (
    saved.text !== item.text ||
    saved.owner !== (item.owner ?? "") ||
    saved.dueAt !== (item.dueAt ?? "")
  ) {
    const next = { text: item.text, owner: item.owner ?? "", dueAt: item.dueAt ?? "" };
    setSaved(next);
    setText(next.text);
    setOwner(next.owner);
    setDueAt(next.dueAt);
  }

  const commit = async () => {
    const edit: NonNullable<TodoPatch["editActionItems"]>[number] = { id: item.id };
    if (text.trim() && text.trim() !== item.text) edit.text = text.trim();
    if (owner.trim() !== (item.owner ?? "")) edit.owner = owner.trim() || null;
    if (dueAt !== (item.dueAt ?? "")) edit.dueAt = dueAt || null;
    if (!text.trim()) setText(item.text); // an empty action item is not allowed
    if (Object.keys(edit).length > 1) await apply({ editActionItems: [edit] });
  };
  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        type="checkbox"
        checked={item.done}
        disabled={busy || !open}
        onChange={(e) =>
          void apply({ actionItems: [{ id: item.id, done: e.target.checked }] })
        }
        aria-label={`Done: ${item.text}`}
        className="accent-accent focus-visible:ring-focus h-4 w-4 shrink-0 focus-visible:ring-2"
      />
      <Input
        value={text}
        disabled={!open}
        aria-label="Action item text"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onEnter}
        className={cn(
          inputClass,
          "min-w-48 flex-1",
          item.done && "text-ink-muted line-through",
        )}
      />
      <Input
        value={owner}
        disabled={!open}
        placeholder="Owner"
        aria-label="Action item owner"
        onChange={(e) => setOwner(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onEnter}
        className={cn(inputClass, "w-36")}
      />
      <Input
        type="date"
        value={dueAt}
        disabled={!open}
        aria-label="Action item due date"
        onChange={(e) => setDueAt(e.target.value)}
        onBlur={() => void commit()}
        className={cn(inputClass, "w-36")}
      />
      <IconButton
        aria-label={`Remove action item: ${item.text}`}
        size="sm"
        disabled={busy || !open}
        onClick={() => void apply({ removeActionItemIds: [item.id] })}
      >
        <XIcon size={14} />
      </IconButton>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Checkpoints: add, rename, reorder, remove, skip, complete
// ---------------------------------------------------------------------------

/** What the sign-off steps need from the dialog: the clock, and how to open the
 *  request dialog. */
export interface SignoffContext {
  prefs: ReminderPrefs;
  nowIso: string;
  onRequest: (checkpointId: string) => void;
  onSettled: () => void;
}

export function CheckpointsEditor({
  todo,
  open,
  busy,
  apply,
  stage,
  signoff,
}: EditorProps & { stage: string | null; signoff?: SignoffContext }) {
  const [label, setLabel] = useState("");
  const [signOff, setSignOff] = useState(false);

  const move = (index: number, by: -1 | 1) => {
    const ids = todo.checkpoints.map((c) => c.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void apply({ checkpointOrder: ids });
  };
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    const added = await apply({
      addCheckpoints: [{ label: label.trim(), kind: signOff ? "approval" : "step" }],
    });
    if (added) {
      setLabel("");
      setSignOff(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {todo.checkpoints.length === 0 && (
        <p className="text-ink-muted text-[13.5px]">
          No checkpoints. Add the steps this work goes through; progress is shown from
          them.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {todo.checkpoints.map((checkpoint, index) => (
          <CheckpointRow
            key={checkpoint.id}
            checkpoint={checkpoint}
            current={open && checkpoint.label === stage && checkpoint.state === "pending"}
            first={index === 0}
            last={index === todo.checkpoints.length - 1}
            open={open}
            busy={busy}
            apply={apply}
            onMove={(by) => move(index, by)}
            panel={
              checkpoint.kind === "approval" && signoff ? (
                <SignoffPanel
                  todo={todo}
                  checkpoint={checkpoint}
                  prefs={signoff.prefs}
                  nowIso={signoff.nowIso}
                  open={open}
                  onRequest={() => signoff.onRequest(checkpoint.id)}
                  onSettled={signoff.onSettled}
                />
              ) : null
            }
          />
        ))}
      </ol>
      {open && (
        <form
          className="border-line flex flex-wrap items-center gap-2 border-t pt-3.5"
          onSubmit={(event) => void add(event)}
        >
          <Input
            value={label}
            placeholder="Add a checkpoint"
            aria-label="New checkpoint"
            onChange={(e) => setLabel(e.target.value)}
            className={cn(inputClass, "min-w-48 flex-1")}
          />
          <label className="text-ink-soft flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={signOff}
              onChange={(e) => setSignOff(e.target.checked)}
              className="accent-accent focus-visible:ring-focus h-4 w-4 focus-visible:ring-2"
            />
            Sign-off step
          </label>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={busy || !label.trim()}
          >
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

function CheckpointRow({
  checkpoint,
  current,
  first,
  last,
  open,
  busy,
  apply,
  onMove,
  panel,
}: {
  checkpoint: Checkpoint;
  current: boolean;
  first: boolean;
  last: boolean;
  open: boolean;
  busy: boolean;
  apply: ApplyPatch;
  onMove: (by: -1 | 1) => void;
  /** The sign-off panel of an approval step, shown under its row. */
  panel?: React.ReactNode;
}) {
  // A sign-off step is completed by recording the sign-off, never by ticking it,
  // and one with a stamp cannot be moved or removed here (the server refuses
  // both): undoing it is Revoke.
  const isSignoff = checkpoint.kind === "approval";
  const stamped = isSignoff && !!signoffOf(checkpoint).stamp;
  const [label, setLabel] = useState(checkpoint.label);
  const [savedLabel, setSavedLabel] = useState(checkpoint.label);
  if (savedLabel !== checkpoint.label) {
    setSavedLabel(checkpoint.label);
    setLabel(checkpoint.label);
  }
  const setState = (state: Checkpoint["state"]) =>
    void apply({ checkpoints: [{ id: checkpoint.id, state }] });
  const rename = async () => {
    const next = label.trim();
    if (!next) return setLabel(checkpoint.label);
    if (next !== checkpoint.label)
      await apply({ renameCheckpoints: [{ id: checkpoint.id, label: next }] });
  };

  return (
    <li
      className={cn(
        "border-line bg-card rounded-control flex flex-wrap items-center gap-2 border px-3.5 py-2.5",
        current && "border-line-strong bg-accent-soft",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-3 w-3 shrink-0 rounded-full border-[1.5px]",
          checkpoint.state === "done" && "border-accent bg-accent",
          checkpoint.state === "skipped" && "border-line-strong bg-chip-strong",
          checkpoint.state === "pending" && "border-ink-faint",
        )}
      />
      <div className="min-w-40 flex-1">
        <Input
          value={label}
          disabled={!open}
          aria-label="Checkpoint name"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={cn(
            "h-8 border-transparent bg-transparent px-1.5 text-[13.5px]",
            checkpoint.state === "pending" ? "text-ink font-semibold" : "text-ink-muted",
          )}
        />
        {(checkpoint.kind === "approval" || checkpoint.doneAt) && (
          <p className="text-ink-muted px-1.5 text-[12px]">
            {checkpoint.kind === "approval" && "sign-off"}
            {checkpoint.kind === "approval" && checkpoint.doneAt && " · "}
            {checkpoint.doneAt &&
              `${checkpoint.state} ${new Date(checkpoint.doneAt).toLocaleDateString(
                "en-GB",
                {
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Kolkata",
                },
              )}`}
          </p>
        )}
      </div>
      {open && (
        <div className="flex shrink-0 items-center gap-1">
          {checkpoint.state === "pending" ? (
            <>
              {!isSignoff && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setState("done")}
                >
                  Done
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setState("skipped")}
              >
                Skip
              </Button>
            </>
          ) : (
            !stamped && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setState("pending")}
              >
                Reopen
              </Button>
            )
          )}
          <IconButton
            aria-label={`Move ${checkpoint.label} up`}
            size="sm"
            disabled={busy || first}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon size={14} />
          </IconButton>
          <IconButton
            aria-label={`Move ${checkpoint.label} down`}
            size="sm"
            disabled={busy || last}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon size={14} />
          </IconButton>
          <IconButton
            aria-label={`Remove checkpoint ${checkpoint.label}`}
            size="sm"
            disabled={busy || stamped}
            title={stamped ? "Revoke the sign-off first" : undefined}
            onClick={() => void apply({ removeCheckpointIds: [checkpoint.id] })}
          >
            <XIcon size={14} />
          </IconButton>
        </div>
      )}
      {panel}
    </li>
  );
}
