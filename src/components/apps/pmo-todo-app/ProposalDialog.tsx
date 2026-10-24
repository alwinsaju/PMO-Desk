"use client";

import { useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { effectiveDraft } from "@/lib/pmo/todoLogic";
import {
  MAX_AI_ATTEMPTS,
  type Proposal,
  type RuntimeSummary,
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
import { proposalWaitNote } from "./toolbarView";
import {
  ErrorLine,
  MESSAGE_PANE,
  Note,
  ProposalStatusBadge,
  ScrollBody,
  SectionLabel,
  SourceBadge,
} from "./parts";

interface ProposalDialogProps {
  /** null closes the dialog. */
  proposal: Proposal | null;
  structuring: StructuringInfo;
  /** The model's state: says why the first message after a sleep is slow. */
  runtime: RuntimeSummary;
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
  runtime,
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
        className="flex h-[min(88vh,760px)] max-h-full max-w-5xl flex-col px-7 pt-6 pb-5"
        // Don't drop the cursor (and a text selection) into the title field.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex shrink-0 items-center gap-3 pr-10">
          <SourceBadge source={shown.summary.source} />
          <DialogTitle className="min-w-0 flex-1 truncate pr-0 text-[23px] tracking-[-0.02em]">
            {shown.summary.subject || "(no subject)"}
          </DialogTitle>
          <ProposalStatusBadge proposal={shown} structuring={structuring} />
        </div>
        <DialogDescription className="sr-only">
          Review the proposed to-do next to the original message, then approve or reject
          it.
        </DialogDescription>

        {notATask && shown.draft && (
          <Note className="mt-3.5 shrink-0">
            The model thinks this is <strong className="text-ink">not a task</strong>:{" "}
            {shown.draft.reason}
          </Note>
        )}
        {isReady && shown.quoteVerified === false && (
          <Note tone="warning" role="alert" className="mt-3.5 flex shrink-0 gap-2.5">
            <WarningIcon size={16} weight="fill" className="text-amber mt-0.5 shrink-0" />
            <span>
              <strong>Check against the original.</strong> The sentence the model quoted
              was not found in the message
              {shown.draft?.quote ? `: “${shown.draft.quote}”` : "."}
            </span>
          </Note>
        )}
        {isFailed && (
          <Note tone="danger" className="mt-3.5 shrink-0">
            The local model could not structure this message
            {shown.ai.error ? ` (${shown.ai.error.replace(/\.$/, "")})` : ""}. Attempts
            used: {shown.ai.attempts} of {MAX_AI_ATTEMPTS}.
          </Note>
        )}
        {(shown.status === "pending" || shown.status === "structuring") && (
          <Note className="mt-3.5 shrink-0">
            {proposalWaitNote(runtime, structuring.paused)}
          </Note>
        )}

        {/* Two panes side by side on a wide screen, stacked and scrolling as one
            below that. */}
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          <div className="flex flex-col md:min-h-0">
            <SectionLabel className="mb-2.5">
              {manual ? "New to-do (typed by you)" : "Proposed to-do"}
            </SectionLabel>
            {showForm && draft ? (
              <ScrollBody className="md:pr-2">
                <DraftForm
                  draft={draft}
                  dueBasis={shown.draft?.dueBasis}
                  disabled={busy}
                  onChange={(next) => {
                    setDraft(next);
                    setDirty(true);
                  }}
                />
              </ScrollBody>
            ) : (
              <p className="text-ink-muted text-[13.5px]">
                {isFailed
                  ? "Retry the model, or create the to-do yourself from the original message."
                  : "The proposal appears here once the model has read the message."}
              </p>
            )}
          </div>

          <div className={cn(MESSAGE_PANE, "h-72 px-5 py-4 md:h-auto md:min-h-0")}>
            <SectionLabel className="mb-2.5">
              Original message
              {isReady && shown.quoteVerified && (
                <span className="text-ink-muted ml-2 font-medium tracking-normal normal-case">
                  quote highlighted
                </span>
              )}
            </SectionLabel>
            <OriginalMessage
              intakeId={shown.intakeId}
              quote={isReady ? shown.draft?.quote : null}
              className="flex min-h-0 flex-1 flex-col"
            />
          </div>
        </div>

        {error && <ErrorLine className="mt-3 shrink-0">{error}</ErrorLine>}

        <div className="border-line mt-4 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-4">
          <p className="text-ink-muted min-w-0 truncate text-[12px]">
            {shown.ai.model && shown.ai.durationMs !== null
              ? `${shown.ai.model} · ${(shown.ai.durationMs / 1000).toFixed(1)} s`
              : ""}
          </p>
          <div className="ml-auto flex flex-wrap justify-end gap-2.5">
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
