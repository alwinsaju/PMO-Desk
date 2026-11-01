"use client";

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui";
import { nextAt } from "@/lib/tasks/sendQueue";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import type { ConfirmCopy } from "./confirmCopy";
import { RecipientReview, toRecipients } from "./RecipientReview";
import type { DraftSummary } from "./types";

interface ConfirmActionDialogProps {
  /** The wording to show; null keeps the dialog closed. */
  copy: ConfirmCopy | null;
  /** The task being confirmed; its draft is read when `copy.showsDraft`. */
  taskId: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Queue the send for a later time (approved now). Offered once the draft's recipients have been read. */
  onQueue?: (at: Date, summary: DraftSummary) => void;
}

const LATER = [
  { label: "Tomorrow 08:00", hour: 8 },
  { label: "Tomorrow 09:00", hour: 9 },
  { label: "Today 14:00 (or tomorrow)", hour: 14 },
] as const;

/** Confirmation in front of Confirm & send / Reject / Force reset. Focus
 *  opens on Cancel so Enter or Space can never trigger the action by
 *  accident; Escape cancels. A send also shows the recipients (with warnings) and
 *  can be queued for later: it is approved now and goes out only while PMO Desk is open. */
export function ConfirmActionDialog({
  copy,
  taskId,
  onConfirm,
  onCancel,
  onQueue,
}: ConfirmActionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [summary, setSummary] = useState<DraftSummary | null>(null);
  const [laterHour, setLaterHour] = useState<number>(LATER[0].hour);

  const confirm = () => {
    if (summary) {
      const recipients = toRecipients(summary);
      useTasksPrefs.getState().update((t) => ({
        ...t,
        recipients: { ...t.recipients, [taskId]: recipients },
      }));
    }
    onConfirm();
  };

  return (
    <Dialog open={copy !== null} onOpenChange={(open) => !open && onCancel()}>
      {copy && (
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogTitle>{copy.title}</DialogTitle>
          {copy.details.length > 0 && (
            <ul className="text-ink mt-3 flex flex-col gap-1 text-[13px]">
              {copy.details.map((line) => (
                <li key={line} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {copy.showsDraft && <RecipientReview taskId={taskId} onSummary={setSummary} />}
          <DialogDescription className="mt-3">{copy.body}</DialogDescription>
          {copy.showsDraft && onQueue && summary && (
            <div
              className="border-line rounded-control mt-3 flex flex-wrap items-center gap-2 border px-3 py-2.5"
              data-testid="send-later"
            >
              <label
                className="text-ink-soft text-[12.5px] font-semibold"
                htmlFor="send-later"
              >
                Or send later
              </label>
              <select
                id="send-later"
                value={laterHour}
                onChange={(e) => setLaterHour(Number(e.target.value))}
                className="rounded-control border-line bg-surface-elevated h-8 border px-2 text-[12.5px]"
              >
                {LATER.map((o) => (
                  <option key={o.hour} value={o.hour}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onQueue(nextAt(new Date(), laterHour), summary)}
              >
                Queue it
              </Button>
              <p className="text-ink-muted w-full text-[11.5px]">
                You approve it now, with these recipients. It is sent only if PMO Desk is
                still open then and nothing has changed; otherwise it waits for you.
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button ref={cancelRef} variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={confirm}>{copy.confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
