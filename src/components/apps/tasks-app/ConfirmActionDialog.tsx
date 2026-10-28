"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui";
import { getDraftSummary } from "./api";
import type { ConfirmCopy } from "./confirmCopy";
import {
  draftSummaryLines,
  parseDraftSummary,
  RECIPIENTS_LOADING,
  RECIPIENTS_UNREADABLE,
} from "./draftSummary";

interface ConfirmActionDialogProps {
  /** The wording to show; null keeps the dialog closed. */
  copy: ConfirmCopy | null;
  /** The task being confirmed; its draft is read when `copy.showsDraft`. */
  taskId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** To / Cc / Subject of the Outlook draft, read fresh each time the dialog opens.
 *  A failed or empty read shows a warning only; it never blocks the confirm. */
function DraftLines({ taskId }: { taskId: string }) {
  const [lines, setLines] = useState<string[]>([RECIPIENTS_LOADING]);
  useEffect(() => {
    let cancelled = false;
    getDraftSummary(taskId)
      .then((reply) => draftSummaryLines(parseDraftSummary(reply)))
      .catch(() => draftSummaryLines(null))
      .then((next) => {
        if (!cancelled) setLines(next);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  const unreadable = lines[0] === RECIPIENTS_UNREADABLE;
  return (
    <ul
      aria-live="polite"
      className={`${unreadable ? "text-amber" : "text-ink"} mt-3 flex flex-col gap-1 text-[13px]`}
    >
      {lines.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

/** Confirmation in front of Confirm & send / Reject / Force reset. Focus
 *  opens on Cancel so Enter or Space can never trigger the action by
 *  accident; Escape cancels. */
export function ConfirmActionDialog({
  copy,
  taskId,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

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
          {copy.showsDraft && <DraftLines taskId={taskId} />}
          <DialogDescription className="mt-3">{copy.body}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button ref={cancelRef} variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={onConfirm}>{copy.confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
