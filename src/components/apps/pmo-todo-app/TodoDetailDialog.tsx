"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { addDays, describeInstant, isSnoozed, nextMondayAfter } from "@/lib/pmo/due";
import {
  allCheckpointsComplete,
  checkpointProgress,
  deriveStage,
  type TodoPatch,
} from "@/lib/pmo/todoLogic";
import { PRIORITIES, type ReminderPrefs, type Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { OriginalMessage } from "./OriginalMessage";
import { SnoozeMenu } from "./SnoozeMenu";
import { Field, Segmented, SourceBadge, TextArea } from "./parts";
import { formatDay } from "./queueView";
import { ActionItemsEditor, CheckpointsEditor } from "./TodoEditors";

interface TodoDetailDialogProps {
  /** null closes the dialog. */
  todo: Todo | null;
  today: string;
  /** Reminder preferences and the server's clock, for the snooze presets. */
  reminders: ReminderPrefs;
  nowIso: string;
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

interface Fields {
  title: string;
  description: string;
  ownerName: string;
  isMe: boolean;
  requesterName: string;
  dueAt: string;
  priority: Todo["priority"];
  waitingOn: string;
}

const fieldsOf = (todo: Todo): Fields => ({
  title: todo.title,
  description: todo.description,
  ownerName: todo.owner.name ?? "",
  isMe: todo.owner.isMe === true,
  requesterName: todo.requester.name ?? "",
  dueAt: todo.dueAt ?? "",
  priority: todo.priority,
  waitingOn: todo.waitingOn ?? "",
});

/** Changes only when a checkpoint's id or state does, so a dismissed "mark it
 *  done?" offer comes back after the set of checkpoints changes and completes
 *  again, but not on every poll. */
const checkpointSignature = (todo: Todo) =>
  `${todo.id}:${todo.checkpoints.map((c) => `${c.id}=${c.state}`).join(",")}`;

export function TodoDetailDialog({
  todo,
  today,
  reminders,
  nowIso,
  onSettled,
  onOpenChange,
}: TodoDetailDialogProps) {
  const [last, setLast] = useState<Todo | null>(todo);
  const [fields, setFields] = useState<Fields | null>(null);
  const [fieldsFor, setFieldsFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedOffer, setDismissedOffer] = useState<string | null>(null);

  if (todo && todo !== last) setLast(todo);
  if (todo && todo.id !== fieldsFor) {
    setFieldsFor(todo.id);
    setFields(fieldsOf(todo));
    setDirty(false);
    setError(null);
  }
  const shown = todo ?? last;
  if (!shown || !fields) return null;

  const apply = async (patch: TodoPatch): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const reply = await patchTodo(shown.id, patch);
      if (!reply.ok) {
        setError(reply.reason);
        return false;
      }
      onSettled();
      return true;
    } catch {
      setError("Could not reach the app server.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const edit = (patch: Partial<Fields>) => {
    setFields({ ...fields, ...patch });
    setDirty(true);
  };

  const save = async () => {
    if (!fields.title.trim()) return setError("A to-do needs a title.");
    const done = await apply({
      title: fields.title.trim(),
      description: fields.description,
      owner: {
        name: fields.ownerName.trim() || null,
        email: shown.owner.email,
        isMe: fields.isMe,
      },
      requester: {
        name: fields.requesterName.trim() || null,
        email: shown.requester.email,
      },
      dueAt: fields.dueAt || null,
      priority: fields.priority,
      waitingOn: fields.waitingOn.trim() || null,
    });
    if (done) setDirty(false);
  };

  const open = shown.status === "open";
  const progress = checkpointProgress(shown);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const stage = deriveStage(shown);
  const signature = checkpointSignature(shown);
  const offer = allCheckpointsComplete(shown) && dismissedOffer !== signature;
  const snoozed = open && isSnoozed(shown, new Date(nowIso));

  const dueChips: { label: string; value: string }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next Monday", value: nextMondayAfter(today) },
    { label: "Clear", value: "" },
  ];

  return (
    <Dialog open={todo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,760px)] max-w-3xl flex-col">
        <div className="flex items-center gap-2 pr-8">
          <SourceBadge source={shown.source.source} />
          <DialogTitle className="min-w-0 flex-1 truncate">{shown.title}</DialogTitle>
        </div>
        <div className="flex items-center justify-between gap-3">
          <DialogDescription className="text-[12px]">
            {open
              ? stage
                ? `Stage: ${stage}`
                : progress.total > 0
                  ? "All checkpoints complete"
                  : "No checkpoints"
              : `Marked ${shown.status}`}
            {" · "}
            {progress.done}/{progress.total} checkpoints
            {shown.dueAt ? ` · Due ${formatDay(shown.dueAt, today)}` : ""}
            {snoozed
              ? ` · Snoozed until ${describeInstant(shown.reminders.snoozedUntil!, reminders.timeZone)}`
              : ""}
          </DialogDescription>
          {open && (
            <SnoozeMenu
              todo={shown}
              prefs={reminders}
              nowIso={nowIso}
              disabled={busy}
              onSnooze={(until) => void apply({ snoozedUntil: until })}
            />
          )}
        </div>
        {progress.total > 0 && (
          <div
            className="bg-neutral-150 mt-2 h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="Checkpoint progress"
          >
            <div
              className="bg-ink ease-standard h-full rounded-full transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}

        {offer && open && (
          <div className="border-border mt-3 flex items-center justify-between gap-3 rounded-lg border bg-neutral-50 px-3 py-2">
            <p className="text-ink text-[12px]">
              Every checkpoint is complete. Mark this to-do as done?
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissedOffer(signature)}
              >
                Not yet
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void apply({ status: "done" })}
              >
                Mark done
              </Button>
            </div>
          </div>
        )}

        <Tabs defaultValue="details" className="mt-3 flex min-h-0 flex-1 flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="items">
              Action items ({shown.actionItems.length})
            </TabsTrigger>
            <TabsTrigger value="checkpoints">
              Checkpoints ({progress.done}/{progress.total})
            </TabsTrigger>
            <TabsTrigger value="original">Original message</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-3 pr-3">
                <Field label="Title">
                  <Input
                    value={fields.title}
                    onChange={(e) => edit({ title: e.target.value })}
                  />
                </Field>
                <Field label="Description">
                  <TextArea
                    value={fields.description}
                    onChange={(e) => edit({ description: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Owner">
                    <Input
                      value={fields.ownerName}
                      onChange={(e) => edit({ ownerName: e.target.value })}
                    />
                  </Field>
                  <Field label="Requester">
                    <Input
                      value={fields.requesterName}
                      onChange={(e) => edit({ requesterName: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="text-ink-muted flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={fields.isMe}
                    onChange={(e) => edit({ isMe: e.target.checked })}
                    className="accent-accent h-3.5 w-3.5"
                  />
                  This is mine (I am the owner)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Due date">
                    <Input
                      type="date"
                      value={fields.dueAt}
                      onChange={(e) => edit({ dueAt: e.target.value })}
                    />
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {dueChips.map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => edit({ dueAt: chip.value })}
                          className="text-ink-muted hover:text-ink rounded-pill border-border focus-visible:ring-accent border px-2 py-0.5 text-[11px] outline-none hover:bg-neutral-100 focus-visible:ring-2"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </span>
                  </Field>
                  <Field label="Waiting on">
                    <Input
                      value={fields.waitingOn}
                      placeholder="Nobody"
                      onChange={(e) => edit({ waitingOn: e.target.value })}
                    />
                    <span className="text-ink-faint text-[11px] leading-relaxed">
                      Set this to get a chaser if nothing changes for{" "}
                      {reminders.chaserDays} working days.
                    </span>
                  </Field>
                </div>
                <Field label="Priority">
                  <Segmented
                    value={fields.priority}
                    onChange={(priority) => edit({ priority })}
                    options={PRIORITIES.map((value) => ({
                      value,
                      label: value[0].toUpperCase() + value.slice(1),
                    }))}
                  />
                </Field>
                <p className="text-ink-faint text-[11px]">
                  Approved{" "}
                  {new Date(shown.approvedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  by {shown.approvedBy}.
                </p>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="items" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <ActionItemsEditor todo={shown} open={open} busy={busy} apply={apply} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="checkpoints" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <CheckpointsEditor
                todo={shown}
                open={open}
                busy={busy}
                apply={apply}
                stage={stage}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="original" className="mt-3 min-h-0 flex-1">
            {shown.source.intakeId ? (
              <OriginalMessage
                intakeId={shown.source.intakeId}
                className="flex h-full min-h-0 flex-col"
              />
            ) : (
              <p className="text-ink-faint text-[13px]">
                This to-do was created by hand, so there is no original message.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <p role="alert" className="text-ink mt-2 text-[12px] font-medium">
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-2">
            {open ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void apply({ status: "done" })}
                >
                  Mark done
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void apply({ status: "cancelled" })}
                >
                  Cancel to-do
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void apply({ status: "open" })}
              >
                Reopen
              </Button>
            )}
          </div>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
