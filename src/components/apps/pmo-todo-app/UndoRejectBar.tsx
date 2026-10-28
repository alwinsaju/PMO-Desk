"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { restoreProposal } from "./api";
import { GUTTER_X } from "./parts";
import { UNDO_REJECT_MS, undoRejectText } from "./queueView";

export interface RejectedItem {
  id: string;
  title: string;
}

interface UndoRejectBarProps {
  item: RejectedItem | null;
  /** The bar went away (time ran out, or the item was restored). */
  onClear: () => void;
  onSettled: () => void;
}

/** "Rejected. Undo" for a few seconds after a Reject; Undo puts the proposal
 *  back in the queue. A refusal stays visible with the server's own words. */
export function UndoRejectBar({ item, onClear, onSettled }: UndoRejectBarProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(item?.id ?? null);

  // A different item starts clean (adjusting state while rendering).
  if (item && item.id !== lastId) {
    setLastId(item.id);
    setError(null);
  }

  useEffect(() => {
    if (!item || busy) return;
    const timer = setTimeout(onClear, UNDO_REJECT_MS);
    return () => clearTimeout(timer);
  }, [item, busy, error, onClear]);

  if (!item) return null;

  async function undo() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await restoreProposal(item.id);
      if (reply.ok) {
        onClear();
      } else {
        setError(reply.reason);
      }
      onSettled();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("shrink-0 pb-3", GUTTER_X)}>
      <p
        role="status"
        className="rounded-card bg-chip text-ink-soft flex items-center gap-3 px-4 py-2 text-[13px]"
      >
        <span className="min-w-0 flex-1 break-words">
          {error ?? undoRejectText(item.title)}
        </span>
        {!error && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void undo()}
          >
            Undo
          </Button>
        )}
        {error && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onClear}>
            Dismiss
          </Button>
        )}
      </p>
    </div>
  );
}
