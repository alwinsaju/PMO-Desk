"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
} from "@/components/ui";
import { effectiveDraft } from "@/lib/pmo/todoLogic";
import {
  MAX_AI_ATTEMPTS,
  type Proposal,
  type StructuringInfo,
  type TodoDraft,
} from "@/lib/pmo/types";
import {
  approveProposal,
  createTodo,
  rejectProposal,
  retryProposal,
  stageEdits,
} from "./api";
import { DraftForm } from "./DraftForm";
import { OriginalMessage } from "./OriginalMessage";
import { ProposalStatusBadge, SourceBadge } from "./parts";

interface ProposalDialogProps {
  /** null closes the dialog. */
  proposal: Proposal | null;
  structuring: StructuringInfo;
  /** Called after any change so the list can refetch right away. */
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Review one proposal: the editable draft beside the original message, with
 * the model's verified quote highlighted. Approve is the only way a to-do
 * comes out of the queue; Reject creates nothing.
 */
export function ProposalDialog({
  proposal,
  structuring,
  onSettled,
  onOpenChange,
}: ProposalDialogProps) {
  // Keep showing the last proposal while the close animation runs.
  const [last, setLast] = useState<Proposal | null>(proposal);
  const [formKey, setFormKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adjusting state while rendering (React's documented alternative to an
  // effect): the form restarts when a different proposal opens or the open
  // one changes status (e.g. structuring -> ready), but not on every poll.
  if (proposal && proposal !== last) setLast(proposal);
  const key = proposal ? `${proposal.id}:${proposal.status}` : null;
  if (proposal && key !== formKey) {
    setFormKey(key);
    setDraft(effectiveDraft(proposal));
    setDirty(false);
    setManual(false);
    setError(null);
  }

  const shown = proposal ?? last;
  if (!shown) return null;

  const isReady = shown.status === "ready";
  const isFailed = shown.status === "failed";
  const showForm = (isReady || manual) && draft !== null;
  const notATask = isReady && shown.isActionable === false;

  async function run(action: () => Promise<{ ok: boolean } & { reason?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const reply = await action();
      if (!reply.ok) {
        setError(reply.reason ?? "That did not work.");
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
  }

  async function close() {
    // Don't lose the reviewer's in-progress edits.
    if (dirty && isReady && draft)
      await stageEdits(shown!.id, draft).catch(() => undefined);
    onOpenChange(false);
  }

  const approve = async () => {
    if (!draft) return;
    const done = await run(() =>
      manual ? createTodo(draft, shown.id) : approveProposal(shown.id, draft),
    );
    if (done) onOpenChange(false);
  };
  const reject = async () => {
    if (await run(() => rejectProposal(shown.id))) onOpenChange(false);
  };

  return (
    <Dialog
      open={proposal !== null}
      onOpenChange={(open) => (open ? undefined : void close())}
    >
      <DialogContent
        className="flex h-[min(82vh,720px)] max-w-5xl flex-col"
        // Don't drop the cursor (and a text selection) into the title field.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2 pr-8">
          <SourceBadge source={shown.summary.source} />
          <DialogTitle className="min-w-0 flex-1 truncate">
            {shown.summary.subject || "(no subject)"}
          </DialogTitle>
          <ProposalStatusBadge proposal={shown} structuring={structuring} />
        </div>
        <DialogDescription className="sr-only">
          Review the proposed to-do next to the original message, then approve or reject
          it.
        </DialogDescription>

        {notATask && shown.draft && (
          <p className="border-border text-ink-muted mt-3 rounded-lg border bg-neutral-50 px-3 py-2 text-[12px]">
            The model thinks this is <strong className="text-ink">not a task</strong>:{" "}
            {shown.draft.reason}
          </p>
        )}
        {isReady && shown.quoteVerified === false && (
          <p
            role="alert"
            className="bg-ink text-ink-inverse mt-3 rounded-lg px-3 py-2 text-[12px]"
          >
            <strong>Check against the original.</strong> The sentence the model quoted was
            not found in the message
            {shown.draft?.quote ? `: “${shown.draft.quote}”` : "."}
          </p>
        )}
        {isFailed && (
          <p className="border-border text-ink mt-3 rounded-lg border bg-neutral-50 px-3 py-2 text-[12px]">
            The local model could not structure this message
            {shown.ai.error ? ` (${shown.ai.error.replace(/\.$/, "")})` : ""}. Attempts
            used: {shown.ai.attempts} of {MAX_AI_ATTEMPTS}.
          </p>
        )}
        {(shown.status === "pending" || shown.status === "structuring") && (
          <p className="border-border text-ink-muted mt-3 rounded-lg border bg-neutral-50 px-3 py-2 text-[12px]">
            {structuring.paused
              ? "Waiting for the local model to come back. This will be structured automatically."
              : "The local model has not finished with this message yet."}
          </p>
        )}

        <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex min-h-0 flex-col">
            <p className="text-ink-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
              {manual ? "New to-do (typed by you)" : "Proposed to-do"}
            </p>
            {showForm && draft ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="pr-3">
                  <DraftForm
                    draft={draft}
                    dueBasis={shown.draft?.dueBasis}
                    disabled={busy}
                    onChange={(next) => {
                      setDraft(next);
                      setDirty(true);
                    }}
                  />
                </div>
              </ScrollArea>
            ) : (
              <p className="text-ink-faint text-[13px]">
                {isFailed
                  ? "Retry the model, or create the to-do yourself from the original message."
                  : "The proposal appears here once the model has read the message."}
              </p>
            )}
          </div>

          <div className="border-border/60 flex min-h-0 flex-col rounded-lg border p-3">
            <p className="text-ink-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
              Original message
              {isReady && shown.quoteVerified && (
                <span className="text-ink-faint ml-2 font-normal normal-case">
                  quote highlighted
                </span>
              )}
            </p>
            <OriginalMessage
              intakeId={shown.intakeId}
              quote={isReady ? shown.draft?.quote : null}
              className="flex min-h-0 flex-1 flex-col"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-ink mt-3 text-[12px] font-medium">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-ink-faint min-w-0 truncate text-[11px]">
            {shown.ai.model && shown.ai.durationMs !== null
              ? `${shown.ai.model} · ${(shown.ai.durationMs / 1000).toFixed(1)} s`
              : ""}
            {shown.confidence !== null
              ? ` · confidence ${Math.round(shown.confidence * 100)}%`
              : ""}
          </p>
          <div className="flex shrink-0 gap-2">
            {isFailed && !manual && shown.ai.attempts < MAX_AI_ATTEMPTS && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run(() => retryProposal(shown.id))}
              >
                Retry
              </Button>
            )}
            {isFailed && !manual && (
              <Button variant="secondary" disabled={busy} onClick={() => setManual(true)}>
                Create manually from original
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={reject}>
              {notATask ? "Dismiss" : "Reject"}
            </Button>
            {showForm && (
              <Button disabled={busy || !draft?.title.trim()} onClick={approve}>
                {manual ? "Create to-do" : notATask ? "Approve anyway" : "Approve"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
