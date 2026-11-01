"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui";
import type { Proposal, RuntimeSummary, StructuringInfo } from "@/lib/pmo/types";
import { ProposalReview, type ProposalReviewHandle } from "./ProposalReview";

interface ProposalDialogProps {
  /** null closes the dialog. */
  proposal: Proposal | null;
  structuring: StructuringInfo;
  /** The model's state: says why the first message after a sleep is slow. */
  runtime: RuntimeSummary;
  /** Called after any change so the list can refetch right away. */
  onSettled: () => void;
  /** The proposal was rejected from this dialog (the window offers an Undo). */
  onRejected?: (proposal: Proposal) => void;
  onOpenChange: (open: boolean) => void;
}

/** The review (`ProposalReview`) in a dialog, for a narrow window. A wide one
 *  shows it beside the queue list instead. */
export function ProposalDialog({
  proposal,
  structuring,
  runtime,
  onSettled,
  onRejected,
  onOpenChange,
}: ProposalDialogProps) {
  // Keep showing the last proposal while the close animation runs.
  const [last, setLast] = useState<Proposal | null>(proposal);
  const review = useRef<ProposalReviewHandle>(null);
  if (proposal && proposal !== last) setLast(proposal);
  const shown = proposal ?? last;
  if (!shown) return null;

  return (
    <Dialog
      open={proposal !== null}
      onOpenChange={(open) => {
        if (open) return;
        // Don't lose the reviewer's in-progress edits.
        void (review.current?.flush() ?? Promise.resolve()).then(() =>
          onOpenChange(false),
        );
      }}
    >
      <DialogContent
        className="flex h-[min(88vh,760px)] max-h-full max-w-5xl flex-col px-7 pt-6 pb-5"
        // Don't drop the cursor (and a text selection) into the title field.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <ProposalReview
          ref={review}
          surface="dialog"
          proposal={shown}
          structuring={structuring}
          runtime={runtime}
          onSettled={onSettled}
          onRejected={onRejected}
          onFinished={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
