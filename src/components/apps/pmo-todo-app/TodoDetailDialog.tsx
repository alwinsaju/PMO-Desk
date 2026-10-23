"use client";

import { useState } from "react";
import { XIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  allCheckpointsComplete,
  checkpointProgress,
  deriveStage,
  type TodoPatch,
} from "@/lib/pmo/todoLogic";
import { PRIORITIES, type Todo } from "@/lib/pmo/types";
import { patchTodo } from "./api";
import { OriginalMessage } from "./OriginalMessage";
import { Field, Segmented, SourceBadge, TextArea } from "./parts";
import { formatDay } from "./queueView";

interface TodoDetailDialogProps {
  /** null closes the dialog. */
  todo: Todo | null;
  today: string;
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

export function TodoDetailDialog({
  todo,
  today,
  onSettled,
  onOpenChange,
}: TodoDetailDialogProps) {
  const [last, setLast] = useState<Todo | null>(todo);
  const [fields, setFields] = useState<Fields | null>(null);
  const [fieldsFor, setFieldsFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [dismissedOffer, setDismissedOffer] = useState<string | null>(null);

  if (todo && todo !== last) setLast(todo);
  if (todo && todo.id !== fieldsFor) {
    setFieldsFor(todo.id);
    setFields(fieldsOf(todo));
    setDirty(false);
    setError(null);
    setNewItem("");
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
  const stage = deriveStage(shown);
  const offer = allCheckpointsComplete(shown) && dismissedOffer !== shown.id;

  return (
    <Dialog open={todo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(82vh,700px)] max-w-3xl flex-col">
        <div className="flex items-center gap-2 pr-8">
          <SourceBadge source={shown.source.source} />
          <DialogTitle className="min-w-0 flex-1 truncate">{shown.title}</DialogTitle>
        </div>
        <DialogDescription className="text-[12px]">
          {open
            ? stage
              ? `Stage: ${stage}`
              : "All checkpoints complete"
            : `Marked ${shown.status}`}
          {" · "}
          {progress.done}/{progress.total} checkpoints
          {shown.dueAt ? ` · Due ${formatDay(shown.dueAt, today)}` : ""}
        </DialogDescription>

        {offer && open && (
          <div className="border-border mt-3 flex items-center justify-between gap-3 rounded-lg border bg-neutral-50 px-3 py-2">
            <p className="text-ink text-[12px]">
              Every checkpoint is complete. Mark this to-do as done?
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissedOffer(shown.id)}
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
            <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
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
                  </Field>
                  <Field label="Waiting on">
                    <Input
                      value={fields.waitingOn}
                      placeholder="Nobody"
                      onChange={(e) => edit({ waitingOn: e.target.value })}
                    />
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
              <ul className="flex flex-col gap-1.5 pr-3">
                {shown.actionItems.length === 0 && (
                  <li className="text-ink-faint text-[13px]">No action items yet.</li>
                )}
                {shown.actionItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={busy || !open}
                      onChange={(e) =>
                        void apply({
                          actionItems: [{ id: item.id, done: e.target.checked }],
                        })
                      }
                      aria-label={item.text}
                      className="accent-accent h-4 w-4 shrink-0"
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-[13px]",
                        item.done ? "text-ink-faint line-through" : "text-ink",
                      )}
                    >
                      {item.text}
                    </span>
                    <IconButton
                      aria-label="Remove action item"
                      size="sm"
                      disabled={busy || !open}
                      onClick={() => void apply({ removeActionItemIds: [item.id] })}
                    >
                      <XIcon size={14} />
                    </IconButton>
                  </li>
                ))}
              </ul>
              {open && (
                <form
                  className="mt-3 flex gap-2 pr-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!newItem.trim()) return;
                    if (await apply({ addActionItems: [{ text: newItem.trim() }] }))
                      setNewItem("");
                  }}
                >
                  <Input
                    value={newItem}
                    placeholder="Add an action item"
                    onChange={(e) => setNewItem(e.target.value)}
                    className="h-9"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={busy || !newItem.trim()}
                  >
                    Add
                  </Button>
                </form>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="checkpoints" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <ol className="flex flex-col gap-2 pr-3">
                {shown.checkpoints.map((checkpoint) => {
                  const isCurrent = open && checkpoint.label === stage;
                  return (
                    <li
                      key={checkpoint.id}
                      className={cn(
                        "border-border/60 flex items-center gap-3 rounded-xl border px-3 py-2",
                        isCurrent && "border-ink",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full border",
                          checkpoint.state === "done" && "border-ink bg-ink",
                          checkpoint.state === "skipped" &&
                            "border-ink-faint bg-neutral-300",
                          checkpoint.state === "pending" && "border-ink-faint",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[13px]",
                            checkpoint.state === "pending"
                              ? "text-ink font-medium"
                              : "text-ink-muted",
                          )}
                        >
                          {checkpoint.label}
                          {checkpoint.kind === "approval" && (
                            <span className="text-ink-faint ml-2 text-[11px]">
                              sign-off
                            </span>
                          )}
                        </p>
                        {checkpoint.doneAt && (
                          <p className="text-ink-faint text-[11px]">
                            {checkpoint.state}{" "}
                            {new Date(checkpoint.doneAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              timeZone: "Asia/Kolkata",
                            })}
                          </p>
                        )}
                      </div>
                      {open && (
                        <div className="flex shrink-0 gap-1.5">
                          {checkpoint.state === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void apply({
                                    checkpoints: [{ id: checkpoint.id, state: "done" }],
                                  })
                                }
                              >
                                Done
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() =>
                                  void apply({
                                    checkpoints: [
                                      { id: checkpoint.id, state: "skipped" },
                                    ],
                                  })
                                }
                              >
                                Skip
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void apply({
                                  checkpoints: [{ id: checkpoint.id, state: "pending" }],
                                })
                              }
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
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
