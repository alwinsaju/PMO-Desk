"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { addDays, describeInstant, isSnoozed, nextMondayAfter } from "@/lib/pmo/due";
import { nextTodoDraft } from "@/lib/pmo/recurrence";
import {
  allCheckpointsComplete,
  checkpointProgress,
  deriveStage,
  type TodoPatch,
} from "@/lib/pmo/todoLogic";
import {
  PRIORITIES,
  type ChaserJob,
  type PmoConfig,
  type ReminderPrefs,
  type Todo,
} from "@/lib/pmo/types";
import { ChaserDialog } from "./ChaserDialog";
import {
  clearCancelled,
  createTodo,
  patchTodo,
  startChaser,
  type NextOffer,
} from "./api";
import { OriginalMessage } from "./OriginalMessage";
import { SignoffRequestDialog } from "./SignoffRequestDialog";
import { SnoozeMenu } from "./SnoozeMenu";
import {
  ErrorLine,
  Field,
  MESSAGE_PANE,
  Note,
  QuickChip,
  ScrollBody,
  Segmented,
  SourceBadge,
  TextArea,
} from "./parts";
import { formatDay, repeatsText } from "./queueView";
import { cn } from "@/lib/cn";
import { TimelineTab } from "./TimelineTab";
import { ActionItemsEditor, CheckpointsEditor } from "./TodoEditors";
import { WaitingPanel } from "./WaitingPanel";

interface TodoDetailDialogProps {
  /** null closes the dialog. */
  todo: Todo | null;
  today: string;
  /** Reminder preferences and the server's clock, for the snooze presets. */
  reminders: ReminderPrefs;
  nowIso: string;
  /** The chaser draft for this to-do (polled state), if there is one. */
  chaser?: ChaserJob;
  /** The AI-improved sign-off request text for this to-do, if one was started. */
  signoffDraft?: ChaserJob;
  /** The next round of a repeating to-do that was just marked done, if any. */
  nextOffer?: NextOffer | null;
  onNextOffer?: (offer: NextOffer | null) => void;
  /** Who "me" is, for the sign-off of a request text. */
  me: PmoConfig["me"];
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
}

/** The strip of tabs: each keeps its width and the strip scrolls. */
const TAB = "shrink-0 whitespace-nowrap";
/** A tab's content: the rest of the dialog, scrolling on its own. */
const PANEL = "mt-3 flex min-h-0 flex-1 flex-col";

const fieldsOf = (todo: Todo): Fields => ({
  title: todo.title,
  description: todo.description,
  ownerName: todo.owner.name ?? "",
  isMe: todo.owner.isMe === true,
  requesterName: todo.requester.name ?? "",
  dueAt: todo.dueAt ?? "",
  priority: todo.priority,
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
  chaser,
  signoffDraft,
  nextOffer,
  onNextOffer,
  me,
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
  const [chaserOpen, setChaserOpen] = useState(false);
  /** The sign-off checkpoint whose request dialog is open. */
  const [signoffFor, setSignoffFor] = useState<string | null>(null);

  if (todo && todo !== last) setLast(todo);
  if (todo && todo.id !== fieldsFor) {
    setFieldsFor(todo.id);
    setFields(fieldsOf(todo));
    setDirty(false);
    setError(null);
    setChaserOpen(false);
    setSignoffFor(null);
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
      if (reply.nextOccurrence) {
        onNextOffer?.({ todo: reply.todo, dueAt: reply.nextOccurrence.dueAt });
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

  /** Delete a cancelled to-do for good, then close the dialog. */
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await clearCancelled([shown.id]);
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
      onSettled();
      onOpenChange(false);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  /** "Create next one": a new to-do through the ordinary create action. */
  const createNext = async () => {
    if (!nextOffer) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await createTodo(nextTodoDraft(nextOffer.todo, nextOffer.dueAt));
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
      onNextOffer?.(null);
      onSettled();
    } catch {
      setError("Could not reach the app server.");
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
    });
    if (done) setDirty(false);
  };

  const open = shown.status === "open";
  const repeats = repeatsText(shown.recurrence);
  const progress = checkpointProgress(shown);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const stage = deriveStage(shown);
  const signature = checkpointSignature(shown);
  const offer = allCheckpointsComplete(shown) && dismissedOffer !== signature;
  const snoozed = open && isSnoozed(shown, new Date(nowIso));

  /** Start (or reopen) the local model's chaser draft, then show it. */
  const draftChaser = async () => {
    if (chaser && chaser.status !== "failed") {
      setChaserOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reply = await startChaser(shown.id);
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
      onSettled();
      setChaserOpen(true);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const dueChips: { label: string; value: string }[] = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next Monday", value: nextMondayAfter(today) },
    { label: "Clear", value: "" },
  ];

  return (
    <Dialog open={todo !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(88vh,780px)] max-h-full max-w-[700px] flex-col px-[30px] pt-7 pb-6"
        // Do not park the focus ring on the Snooze button when the dialog opens.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex shrink-0 items-center gap-3 pr-10">
          <SourceBadge source={shown.source.source} />
          <DialogTitle className="min-w-0 flex-1 truncate pr-0 text-[23px] tracking-[-0.02em]">
            {shown.title}
          </DialogTitle>
        </div>
        <div className="mt-1 flex shrink-0 items-center justify-between gap-3">
          <DialogDescription className="mt-0 min-w-0 text-[13px]">
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
        {repeats && (
          <p
            data-testid="repeats-text"
            title="Shown for reference. The app does not repeat to-dos or send recurring reminders."
            className="text-ink-muted mt-1 shrink-0 truncate text-[12.5px]"
          >
            {repeats}
          </p>
        )}
        {progress.total > 0 && (
          <Progress
            value={percent}
            state={allCheckpointsComplete(shown) ? "ok" : "idle"}
            aria-label="Checkpoint progress"
            aria-valuetext={`${progress.done} of ${progress.total} checkpoints`}
            className="mt-3.5 shrink-0"
          />
        )}

        {nextOffer && nextOffer.todo.id === shown.id && shown.status === "done" && (
          <Note
            role="status"
            tone="accent"
            className="mt-3.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <p data-testid="next-offer" className="text-ink text-[13px] font-semibold">
              Marked done. This to-do repeats ({repeats}).
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => onNextOffer?.(null)}>
                Not now
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void createNext()}>
                Create next one (due {formatDay(nextOffer.dueAt, today)})
              </Button>
            </div>
          </Note>
        )}

        {offer && open && (
          <Note
            tone="accent"
            className="mt-3.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
          >
            <p className="text-ink text-[13px] font-semibold">
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
          </Note>
        )}

        <Tabs defaultValue="details" className="mt-4 flex min-h-0 flex-1 flex-col">
          {/* Five tabs do not fit a small dialog: the strip scrolls sideways. */}
          <div className="max-w-full shrink-0 [scrollbar-width:none] self-start overflow-x-auto">
            <TabsList>
              <TabsTrigger value="details" className={TAB}>
                Details
              </TabsTrigger>
              <TabsTrigger value="items" className={TAB} count={shown.actionItems.length}>
                Action items
              </TabsTrigger>
              <TabsTrigger
                value="checkpoints"
                className={TAB}
                count={`${progress.done}/${progress.total}`}
              >
                Checkpoints
              </TabsTrigger>
              <TabsTrigger
                value="timeline"
                className={TAB}
                count={shown.history?.length ?? 0}
              >
                Timeline
              </TabsTrigger>
              <TabsTrigger value="original" className={TAB}>
                Original message
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="details" className={PANEL}>
            <ScrollBody className="pr-2">
              <div className="flex flex-col gap-3.5">
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
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
                <label className="text-ink-soft flex items-center gap-2.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={fields.isMe}
                    onChange={(e) => edit({ isMe: e.target.checked })}
                    className="accent-accent focus-visible:ring-focus h-4 w-4 focus-visible:ring-2"
                  />
                  This is mine (I am the owner)
                </label>
                <WaitingPanel
                  todo={shown}
                  prefs={reminders}
                  nowIso={nowIso}
                  today={today}
                  busy={busy}
                  job={chaser}
                  apply={apply}
                  onDraftChaser={() => void draftChaser()}
                />
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <Field label="Due date">
                    <Input
                      type="date"
                      value={fields.dueAt}
                      onChange={(e) => edit({ dueAt: e.target.value })}
                    />
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {dueChips.map((chip) => (
                        <QuickChip
                          key={chip.label}
                          onClick={() => edit({ dueAt: chip.value })}
                        >
                          {chip.label}
                        </QuickChip>
                      ))}
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
                <p className="text-ink-muted text-[12px]">
                  Approved{" "}
                  {new Date(shown.approvedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  by {shown.approvedBy}.
                </p>
              </div>
            </ScrollBody>
          </TabsContent>

          <TabsContent value="items" className={PANEL}>
            <ScrollBody className="pr-2">
              <ActionItemsEditor todo={shown} open={open} busy={busy} apply={apply} />
            </ScrollBody>
          </TabsContent>

          <TabsContent value="checkpoints" className={PANEL}>
            <ScrollBody className="pr-2">
              <CheckpointsEditor
                todo={shown}
                open={open}
                busy={busy}
                apply={apply}
                stage={stage}
                signoff={{
                  prefs: reminders,
                  nowIso,
                  onRequest: setSignoffFor,
                  onSettled,
                }}
              />
            </ScrollBody>
          </TabsContent>

          <TabsContent value="timeline" className={PANEL}>
            <ScrollBody className="pr-2">
              <TimelineTab todo={shown} />
            </ScrollBody>
          </TabsContent>

          <TabsContent value="original" className={PANEL}>
            {shown.source.intakeId ? (
              <div className={cn(MESSAGE_PANE, "min-h-0 flex-1")}>
                <OriginalMessage
                  intakeId={shown.source.intakeId}
                  className="flex min-h-0 flex-1 flex-col"
                />
              </div>
            ) : (
              <p className="text-ink-muted text-[13.5px]">
                This to-do was created by hand, so there is no original message.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {error && <ErrorLine className="mt-3 shrink-0">{error}</ErrorLine>}

        <div className="border-line mt-4 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-4">
          <div className="flex flex-wrap gap-2">
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
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void apply({ status: "open" })}
                >
                  Reopen
                </Button>
                {shown.status === "cancelled" && (
                  <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      </DialogContent>
      <SignoffRequestDialog
        todo={shown}
        checkpoint={shown.checkpoints.find((c) => c.id === signoffFor) ?? null}
        job={signoffDraft}
        me={me}
        open={signoffFor !== null && open}
        onOpenChange={(next) => {
          if (!next) setSignoffFor(null);
        }}
        onSettled={onSettled}
      />
      <ChaserDialog
        todo={shown}
        job={chaser}
        open={chaserOpen && open}
        onOpenChange={setChaserOpen}
        onSettled={onSettled}
      />
    </Dialog>
  );
}
