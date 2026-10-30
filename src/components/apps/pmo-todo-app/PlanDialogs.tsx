"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { extractActionItems, weeklyPlan, type ExtractedItem } from "@/lib/pmo/pmoViews";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import type { PmoState } from "@/lib/pmo/types";
import { createTodo } from "./api";
import { ErrorLine, Field, PanelMessage, ScrollBody, TextArea } from "./parts";
import { formatDay } from "./queueView";

/** A Monday pass: the few to-dos worth doing this week, each with the reason it made the list. */
export function PlanWeekDialog({
  state,
  open,
  onOpenChange,
  onOpenTodo,
}: {
  state: PmoState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTodo: (id: string) => void;
}) {
  const plan = weeklyPlan(
    state.todos,
    state.today,
    new Date(state.serverTime),
    state.config.reminders,
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Plan my week</DialogTitle>
        <DialogDescription>
          Your top {plan.length || 5} for this week, from priority, due dates and what is
          waiting. Nothing changes until you open one.
        </DialogDescription>
        {plan.length === 0 ? (
          <PanelMessage>Nothing needs planning this week.</PanelMessage>
        ) : (
          <ScrollBody className="mt-3 max-h-[60vh]">
            <ol className="flex flex-col gap-2" data-testid="week-plan">
              {plan.map((entry, i) => (
                <li key={entry.todo.id} className="bg-chip rounded-control px-3 py-2.5">
                  <button
                    type="button"
                    className="text-ink focus-visible:ring-focus text-left text-[13.5px] font-semibold outline-none hover:underline focus-visible:ring-2"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenTodo(entry.todo.id);
                    }}
                  >
                    {i + 1}. {entry.todo.title}
                  </button>
                  <p className="text-ink-muted mt-0.5 text-[12px]">
                    {entry.reasons.join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          </ScrollBody>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Paste meeting notes: lines that read like actions are listed, and only the ones you tick become to-dos. */
export function MeetingNotesDialog({
  state,
  open,
  onOpenChange,
  onSettled,
}: {
  state: PmoState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<ExtractedItem[] | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = () => {
    const found = extractActionItems(text, state.today);
    setItems(found);
    setTicked(new Set(found.map((_, i) => i)));
    setError(null);
  };

  const close = (next: boolean) => {
    if (!next) {
      setText("");
      setItems(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const add = async () => {
    if (!items) return;
    setBusy(true);
    setError(null);
    let made = 0;
    let failed = false;
    try {
      for (const [i, item] of items.entries()) {
        if (!ticked.has(i)) continue;
        const reply = await createTodo({
          ...emptyDraft(item.title),
          owner: { name: item.owner, email: null, isMe: item.owner === null },
          dueAt: item.dueAt,
        });
        if (!reply.ok) {
          setError(reply.reason);
          failed = true;
          break;
        }
        made += 1;
      }
    } catch {
      setError("Could not reach the app server.");
      failed = true;
    } finally {
      setBusy(false);
    }
    if (made > 0) {
      onSettled();
      toast({
        tone: "success",
        message: `Added ${made} to-do${made === 1 ? "" : "s"} from the notes.`,
      });
      if (!failed) close(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[600px]">
        <DialogTitle>Add to-dos from meeting notes</DialogTitle>
        <DialogDescription>
          Paste the notes. Lines such as “Action: …”, “- [ ] …” or “Priya to send the deck
          Fri” are found on this computer; you choose which become to-dos.
        </DialogDescription>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Notes">
            <TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-32"
              aria-label="Meeting notes"
            />
          </Field>
          {items && items.length === 0 && (
            <p className="text-ink-muted text-[13px]">
              No action items found. Try lines that start with “Action:” or “- [ ]”.
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="flex flex-col gap-1.5" data-testid="meeting-items">
              {items.map((item, i) => (
                <li key={`${i}-${item.title}`}>
                  <label className="text-ink flex items-start gap-2.5 text-[13px]">
                    <input
                      type="checkbox"
                      checked={ticked.has(i)}
                      onChange={() =>
                        setTicked((cur) => {
                          const next = new Set(cur);
                          if (!next.delete(i)) next.add(i);
                          return next;
                        })
                      }
                      className="accent-accent mt-0.5 h-4 w-4"
                    />
                    <span>
                      {item.title}
                      <span className="text-ink-muted">
                        {item.owner ? ` · ${item.owner}` : ""}
                        {item.dueAt ? ` · due ${formatDay(item.dueAt, state.today)}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <ErrorLine className="mt-3">{error}</ErrorLine>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            Close
          </Button>
          <Button variant="outline" disabled={!text.trim()} onClick={find}>
            Find action items
          </Button>
          <Button disabled={busy || ticked.size === 0} onClick={() => void add()}>
            Add {ticked.size || ""} to-do{ticked.size === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
