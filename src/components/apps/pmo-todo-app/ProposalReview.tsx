"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ElementType,
  type Ref,
} from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { Button, DialogDescription, DialogTitle } from "@/components/ui";
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
import { FALLBACK_HINT, partLabel, structuringFellBack } from "./queueView";
import { proposalWaitNote } from "./toolbarView";
import {
  Chip,
  ErrorLine,
  MESSAGE_PANE,
  Note,
  ProposalStatusBadge,
  ScrollBody,
  SectionLabel,
  SourceBadge,
  Spinner,
} from "./parts";

export interface ProposalReviewHandle {
  /** Save the reviewer's unsaved edits so they are still there next time. */
  flush: () => Promise<void>;
}

interface ProposalReviewProps {
  proposal: Proposal;
  structuring: StructuringInfo;
  /** The model's state: says why the first message after a sleep is slow. */
  runtime: RuntimeSummary;
  /** Called after any change so the list can refetch right away. */
  onSettled: () => void;
  /** The proposal was rejected from here (the window offers an Undo). */
  onRejected?: (proposal: Proposal) => void;
  /** Approved or rejected: the review has nothing left to show. */
  onFinished: () => void;
  /** "dialog" lives inside a Dialog (title and description are the dialog's);
   *  "pane" sits beside the queue list. */
  surface: "dialog" | "pane";
  ref?: Ref<ProposalReviewHandle>;
}

/**
 * Review one proposal: the editable draft beside the original message, with
 * the model's verified quote highlighted, and a footer that stays in view.
 * Approve is the only way a to-do comes out of the queue; Reject creates
 * nothing. The two panes sit side by side when this component is wide enough
 * (container query), and stack and scroll as one below that. Unsaved edits are
 * staged when it goes away, so switching rows loses nothing.
 */
export function ProposalReview({
  proposal,
  structuring,
  runtime,
  onSettled,
  onRejected,
  onFinished,
  surface,
  ref,
}: ProposalReviewProps) {
  const [formKey, setFormKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adjusting state while rendering (React's documented alternative to an
  // effect): the form restarts when a different proposal opens or the open
  // one changes status (e.g. structuring -> ready), but not on every poll.
  const key = `${proposal.id}:${proposal.status}`;
  if (key !== formKey) {
    setFormKey(key);
    setDraft(effectiveDraft(proposal));
    setDirty(false);
    setManual(false);
    setApproving(false);
    setError(null);
  }

  const isReady = proposal.status === "ready";
  const isFailed = proposal.status === "failed";
  const showForm = (isReady || manual) && draft !== null;
  const notATask = isReady && proposal.isActionable === false;
  const adjustments = isReady ? (proposal.ai.adjustments ?? []) : [];

  const pending = useRef({ id: proposal.id, draft, stageable: false });
  const settled = useRef(false);
  useEffect(() => {
    pending.current = {
      id: proposal.id,
      draft,
      stageable: dirty && isReady && !settled.current,
    };
  });
  const flush = useCallback(async () => {
    const { id, draft: latest, stageable } = pending.current;
    if (!stageable || !latest) return;
    pending.current = { id, draft: latest, stageable: false };
    await stageEdits(id, latest).catch(() => undefined);
  }, []);
  useImperativeHandle(ref, () => ({ flush }), [flush]);
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

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

  // Once approved or rejected there is nothing left to stage edits to.
  const settle = () => {
    settled.current = true;
    pending.current = { ...pending.current, stageable: false };
  };
  const approve = async () => {
    if (!draft) return;
    setApproving(true);
    const done = await run(() =>
      manual ? createTodo(draft, proposal.id) : approveProposal(proposal.id, draft),
    );
    // On success the review closes with "Creating to-do…" still showing.
    if (done) {
      settle();
      onFinished();
    } else setApproving(false);
  };
  const reject = async () => {
    if (await run(() => rejectProposal(proposal.id))) {
      settle();
      onRejected?.(proposal);
      onFinished();
    }
  };

  const Title: ElementType = surface === "dialog" ? DialogTitle : "h2";

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex shrink-0 items-center gap-3",
          surface === "dialog" && "pr-10",
        )}
      >
        <SourceBadge source={proposal.summary.source} />
        <Title
          className={cn(
            "min-w-0 flex-1 truncate pr-0 tracking-[-0.02em]",
            surface === "dialog"
              ? "text-[23px]"
              : "text-ink text-[20px] leading-tight font-bold",
          )}
        >
          {proposal.summary.subject || "(no subject)"}
        </Title>
        {partLabel(proposal) && (
          <Chip
            className="shrink-0"
            title="This message held several separate tasks; each has its own review item"
          >
            {partLabel(proposal)}
          </Chip>
        )}
        {proposal.possibleDuplicateOf && (
          <Chip
            className="shrink-0"
            title="Looks like another task from the same message, but is not identical"
          >
            Possible duplicate
          </Chip>
        )}
        <ProposalStatusBadge proposal={proposal} structuring={structuring} />
      </div>
      {surface === "dialog" && (
        <DialogDescription className="sr-only">
          Review the proposed to-do next to the original message, then approve or reject
          it.
        </DialogDescription>
      )}

      {notATask && proposal.draft && (
        <Note className="mt-3.5 shrink-0">
          The model thinks this is <strong className="text-ink">not a task</strong>
          {proposal.draft.reason ? <>: {proposal.draft.reason}</> : "."}
        </Note>
      )}
      {structuringFellBack(proposal) && !notATask && (
        <Note
          tone="warning"
          role="alert"
          data-testid="structuring-fallback"
          className="mt-3.5 flex shrink-0 gap-2.5"
        >
          <WarningIcon size={16} weight="fill" className="text-amber mt-0.5 shrink-0" />
          <span>
            <strong>The AI could not structure this message.</strong> {FALLBACK_HINT}
          </span>
        </Note>
      )}
      {isReady && proposal.quoteVerified === false && (
        <Note tone="warning" role="alert" className="mt-3.5 flex shrink-0 gap-2.5">
          <WarningIcon size={16} weight="fill" className="text-amber mt-0.5 shrink-0" />
          <span>
            <strong>Check against the original.</strong> The sentence the model quoted was
            not found in the message
            {proposal.draft?.quote ? `: “${proposal.draft.quote}”` : "."}
          </span>
        </Note>
      )}
      {isReady && proposal.replyBelowQuote && (
        <Note className="mt-3.5 shrink-0">
          The reply may be below the quoted text: the part under the quote was kept so the
          request is not lost. Check it against the original.
        </Note>
      )}
      {isFailed && (
        <Note tone="danger" className="mt-3.5 shrink-0">
          The local model could not structure this message
          {proposal.ai.error ? ` (${proposal.ai.error.replace(/\.$/, "")})` : ""}.
          Attempts used: {proposal.ai.attempts} of {MAX_AI_ATTEMPTS}.
        </Note>
      )}
      {(proposal.status === "pending" || proposal.status === "structuring") && (
        <Note className="mt-3.5 shrink-0">
          {proposalWaitNote(runtime, structuring.paused)}
        </Note>
      )}

      {/* Two panes side by side when there is room, stacked and scrolling as one
          below that. */}
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto @3xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @3xl:grid-rows-[minmax(0,1fr)] @3xl:overflow-hidden">
        <div className="flex flex-col @3xl:min-h-0">
          <SectionLabel className="mb-2.5">
            {manual ? "New to-do (typed by you)" : "Proposed to-do"}
          </SectionLabel>
          {showForm && draft ? (
            <ScrollBody className="@3xl:pr-2">
              {adjustments.length > 0 && !manual && (
                <p
                  data-testid="adjusted-by-app"
                  className="text-ink-muted mb-3 text-[12px] leading-snug"
                >
                  Adjusted by the app: {adjustments.join(" ")}
                </p>
              )}
              <DraftForm
                draft={draft}
                dueBasis={proposal.draft?.dueBasis}
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

        <div className={cn(MESSAGE_PANE, "h-72 px-5 py-4 @3xl:h-auto @3xl:min-h-0")}>
          <SectionLabel className="mb-2.5">
            Original message
            {isReady && proposal.quoteVerified && (
              <span className="text-ink-muted ml-2 font-medium tracking-normal normal-case">
                quote highlighted
              </span>
            )}
          </SectionLabel>
          <OriginalMessage
            intakeId={proposal.intakeId}
            quote={isReady ? proposal.draft?.quote : null}
            className="flex min-h-0 flex-1 flex-col"
          />
        </div>
      </div>

      {error && <ErrorLine className="mt-3 shrink-0">{error}</ErrorLine>}

      <div className="border-line mt-4 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-4">
        {approving ? (
          <p
            role="status"
            className="text-ink-soft flex min-w-0 items-center gap-2 truncate text-[12.5px] font-semibold"
          >
            <Spinner />
            Creating to-do…
          </p>
        ) : (
          <p className="text-ink-muted min-w-0 truncate text-[12px]">
            {proposal.ai.model && proposal.ai.durationMs !== null
              ? `${proposal.ai.model} · ${(proposal.ai.durationMs / 1000).toFixed(1)} s`
              : ""}
          </p>
        )}
        <div className="ml-auto flex flex-wrap justify-end gap-2.5">
          {isFailed && !manual && proposal.ai.attempts < MAX_AI_ATTEMPTS && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => retryProposal(proposal.id))}
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
            <Button
              disabled={busy || !draft?.title.trim()}
              aria-busy={approving}
              onClick={approve}
            >
              {approving ? (
                <>
                  <Spinner />
                  Creating to-do…
                </>
              ) : manual ? (
                "Create to-do"
              ) : notATask ? (
                "Approve anyway"
              ) : (
                "Approve"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
