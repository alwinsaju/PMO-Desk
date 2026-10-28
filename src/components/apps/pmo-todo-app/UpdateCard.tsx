"use client";

import { useMemo, useState } from "react";
import { ArrowRightIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MAX_AI_ATTEMPTS, type PmoState, type Proposal } from "@/lib/pmo/types";
import {
  UNTICKED_REASON_TEXT,
  UPDATE_KIND_LABEL,
  planUpdate,
  type SignoffSuggestion,
} from "@/lib/pmo/updateLogic";
import { applyUpdate, rejectProposal, retryProposal, separateUpdate } from "./api";
import { OriginalMessage } from "./OriginalMessage";
import {
  Chip,
  ErrorLine,
  MESSAGE_PANE,
  Note,
  ProposalStatusBadge,
  ROW_CARD,
  SourceBadge,
} from "./parts";
import { relativeTime } from "./queueView";

interface UpdateCardProps {
  proposal: Proposal;
  state: PmoState;
  onOpenTodo: (todoId: string) => void;
  onSettled: () => void;
}

/**
 * "Update to existing to-do": a new message in the same conversation as an open
 * to-do. Shows the to-do, what the message would change (before -> after, each
 * change tickable) and the message itself. Approve applies the ticked changes
 * and links the message into the to-do's timeline; Reject discards it;
 * "Create as separate to-do instead" falls back to the normal proposal.
 */
export function UpdateCard({ proposal, state, onOpenTodo, onSettled }: UpdateCardProps) {
  const update = proposal.update!;
  const { summary } = proposal;
  const todo = state.todos.find((t) => t.id === update.todoId) ?? null;
  const open = todo?.status === "open";
  const result = update.result;
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [showMessage, setShowMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () =>
      todo && result
        ? planUpdate(todo, result, {
            sender: { name: summary.senderName, address: summary.senderAddress },
            receivedAt: summary.receivedAt,
            timeZone: state.config.reminders.timeZone,
          })
        : null,
    [
      todo,
      result,
      summary.senderName,
      summary.senderAddress,
      summary.receivedAt,
      state.config.reminders.timeZone,
    ],
  );
  const isOn = (id: string, fallback: boolean) => picked[id] ?? fallback;
  const ticked = plan ? plan.changes.filter((c) => isOn(c.id, c.defaultOn)) : [];

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const reply = await action();
      if (!reply.ok) setError(reply.reason ?? "That did not work.");
      else onSettled();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const status = proposal.status;
  const ready = status === "ready" && !!result && !!plan;
  const sender = summary.senderName ?? summary.senderAddress ?? "Unknown sender";
  const nothing = plan?.kind === "nothing";
  const approveLabel =
    ticked.length > 0
      ? `Approve (apply ${ticked.length} change${ticked.length === 1 ? "" : "s"})`
      : "Approve (just link the message)";

  return (
    <div
      data-testid="update-card"
      className={cn(ROW_CARD, "flex flex-col gap-3.5 p-4 @md:p-5")}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <SourceBadge source={summary.source} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="min-w-0 text-[14.5px] font-semibold">
            {todo ? (
              <button
                type="button"
                onClick={() => onOpenTodo(todo.id)}
                className="text-ink focus-visible:ring-focus line-clamp-2 rounded text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                title="Open this to-do"
              >
                {todo.title}
              </button>
            ) : (
              <span className="text-ink line-clamp-2">{update.todoTitle}</span>
            )}
          </p>
          <p className="text-ink-muted min-w-0 truncate text-[12.5px]">
            Update from {sender}
            {" · "}
            {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
            {summary.subject ? ` · ${summary.subject}` : ""}
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 empty:hidden">
            {ready && plan && (
              <Chip tone={nothing ? "neutral" : "accent"}>
                {UPDATE_KIND_LABEL[plan.kind]}
              </Chip>
            )}
            {ready && plan?.signoff && (
              <Chip tone="accent" className="gap-1" data-testid="signoff-reply-chip">
                <SealCheckIcon size={11} weight="fill" />
                Sign-off reply
              </Chip>
            )}
            {ready && proposal.quoteVerified === false && (
              <Chip
                tone="warning"
                className="gap-1"
                title="The sentence the model quoted was not found in the message"
              >
                <WarningIcon size={11} weight="fill" />
                Check original
              </Chip>
            )}
            {ready && proposal.replyBelowQuote && (
              <Chip title="The sender's text sat under the quoted mail, and was kept">
                The reply may be below the quoted text
              </Chip>
            )}
            {!ready && (
              <ProposalStatusBadge proposal={proposal} structuring={state.structuring} />
            )}
          </div>
          {(todo?.waitingOn?.trim() || (todo && !open) || !todo) && (
            <p className="text-ink-muted text-[12.5px]">
              {todo?.waitingOn?.trim() ? `Waiting on ${todo.waitingOn}` : ""}
              {todo?.waitingOn?.trim() && todo && !open ? " · " : ""}
              {todo && !open ? todo.status : ""}
              {!todo ? "This to-do no longer exists." : ""}
            </p>
          )}
        </div>
      </div>

      {(status === "pending" || status === "structuring") && (
        <p className="text-ink-muted text-[13px]">
          {state.structuring.paused
            ? "Waiting for the local model to come back; this will be read automatically."
            : "The local model is reading this message against the to-do (this can take a minute or two)."}
        </p>
      )}
      {status === "failed" && (
        <Note tone="danger">
          The local model could not read this message
          {proposal.ai.error ? ` (${proposal.ai.error.replace(/\.$/, "")})` : ""}.
          Attempts used: {proposal.ai.attempts} of {MAX_AI_ATTEMPTS}. Retry, or create it
          as a separate to-do.
        </Note>
      )}

      {ready && result && plan && (
        <>
          {result.summary && (
            <p className="text-ink text-[13.5px] leading-relaxed">{result.summary}</p>
          )}
          {plan.changes.length === 0 ? (
            <p className="text-ink-muted text-[13px]">
              {nothing
                ? "Nothing actionable in this message."
                : "Nothing to change on the to-do."}{" "}
              Approving only links the message to the to-do&rsquo;s timeline.
            </p>
          ) : (
            <ul
              className="bg-chip rounded-control flex flex-col gap-3 px-4 py-3.5"
              aria-label="Proposed changes"
            >
              {plan.untickedReason && (
                <li
                  data-testid="unticked-reason"
                  className="text-ink-muted text-[12px] font-semibold"
                >
                  {UNTICKED_REASON_TEXT[plan.untickedReason]}
                </li>
              )}
              {plan.changes.map((change) => {
                const on = isOn(change.id, change.defaultOn);
                return (
                  <li key={change.id} className="flex items-start gap-2.5">
                    <input
                      id={`${proposal.id}-${change.id}`}
                      type="checkbox"
                      checked={on}
                      disabled={busy || !open}
                      onChange={(e) =>
                        setPicked((prev) => ({ ...prev, [change.id]: e.target.checked }))
                      }
                      className="accent-accent focus-visible:ring-focus mt-0.5 h-4 w-4 shrink-0 focus-visible:ring-2"
                    />
                    <label
                      htmlFor={`${proposal.id}-${change.id}`}
                      className="min-w-0 flex-1 text-[13px]"
                    >
                      <span className="text-ink-muted block text-[11px] font-bold tracking-[0.08em] uppercase">
                        {change.label}
                      </span>
                      <span
                        className={cn(
                          "text-ink flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words",
                          !on && "opacity-60",
                        )}
                      >
                        {change.before !== null && (
                          <>
                            <span className="text-ink-muted line-through decoration-1">
                              {change.before}
                            </span>
                            <ArrowRightIcon
                              size={12}
                              className="text-ink-muted shrink-0"
                            />
                          </>
                        )}
                        <span className="font-medium whitespace-pre-wrap">
                          {change.after}
                        </span>
                      </span>
                      {change.hint && (
                        <span
                          className={cn(
                            "mt-0.5 block text-[12px]",
                            (change.kind === "waiting" && plan.replyFrom) ||
                              (change.kind === "signoff" && change.defaultOn)
                              ? "text-accent-ink font-semibold"
                              : "text-ink-muted",
                          )}
                        >
                          {change.hint}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {plan.signoff && (
            <SignoffReading
              suggestion={plan.signoff}
              onOpenTodo={todo ? () => onOpenTodo(todo.id) : undefined}
            />
          )}
        </>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowMessage((v) => !v)}
          aria-expanded={showMessage}
          className="text-ink-muted hover:text-ink focus-visible:ring-focus rounded text-[12.5px] font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2"
        >
          {showMessage ? "Hide the new message" : "Show the new message"}
        </button>
        {showMessage && (
          <div className={cn(MESSAGE_PANE, "mt-2 h-56")}>
            <OriginalMessage
              intakeId={proposal.intakeId}
              quote={ready ? result?.signoffQuote || result?.quote : null}
              className="flex min-h-0 flex-1 flex-col"
            />
          </div>
        )}
      </div>

      {error && <ErrorLine>{error}</ErrorLine>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          className="mr-auto"
          disabled={busy || status === "structuring"}
          onClick={() => void run(() => separateUpdate(proposal.id))}
        >
          Create as separate to-do instead
        </Button>
        {status === "failed" && proposal.ai.attempts < MAX_AI_ATTEMPTS && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => retryProposal(proposal.id))}
          >
            Retry
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => rejectProposal(proposal.id))}
        >
          {nothing ? "Dismiss" : "Reject"}
        </Button>
        {ready && (
          <Button
            disabled={busy || !open}
            onClick={() =>
              void run(() =>
                applyUpdate(
                  proposal.id,
                  ticked.map((c) => c.id),
                ),
              )
            }
          >
            {approveLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

const CLASS_LABEL: Record<SignoffSuggestion["classification"], string> = {
  approved: "approved",
  approved_with_conditions: "approved with conditions",
  changes_requested: "asked for changes",
  rejected: "declined",
  unclear: "unclear",
  not_a_signoff: "not a sign-off",
};

/** What the model made of the reply as a sign-off, in the open: its reasoning,
 *  the sentence it relied on, and anything that made the server cautious. The
 *  model's text is plain text here, never HTML. */
function SignoffReading({
  suggestion,
  onOpenTodo,
}: {
  suggestion: SignoffSuggestion;
  onOpenTodo?: () => void;
}) {
  const unclear = suggestion.classification === "unclear";
  return (
    <div
      data-testid="signoff-reading"
      className="bg-chip rounded-control flex flex-col gap-1 px-4 py-3 text-[12.5px]"
    >
      <p className="text-ink font-semibold">
        {unclear
          ? `This reply may be about the sign-off, but it is unclear (${suggestion.from}).`
          : `Model's reading: ${suggestion.from} ${CLASS_LABEL[suggestion.classification]}.`}
      </p>
      <p className="text-ink-muted break-words">
        Reasoning: {suggestion.reason || "none given"}
      </p>
      {suggestion.quote && (
        <p className="text-ink-muted break-words">
          Quoted: &ldquo;{suggestion.quote}&rdquo;
          {!suggestion.quoteVerified && (
            <span className="text-amber font-semibold">
              {" "}
              (not found in the message: check the original)
            </span>
          )}
        </p>
      )}
      {suggestion.guard && <p className="text-amber font-semibold">{suggestion.guard}</p>}
      {unclear && (
        <p className="text-ink-muted">
          Nothing is recorded from this. Approving only links the message; record the
          sign-off yourself on the to-do if it was one.
          {onOpenTodo && (
            <>
              {" "}
              <button
                type="button"
                onClick={onOpenTodo}
                className="text-ink-soft hover:text-ink focus-visible:ring-focus rounded font-semibold underline underline-offset-2 outline-none focus-visible:ring-2"
              >
                Open the to-do
              </button>
            </>
          )}
        </p>
      )}
      {!unclear && (
        <p className="text-ink-muted">
          If you tick the sign-off, this message becomes its evidence and your Windows
          user name and the time are stamped on it.
        </p>
      )}
    </div>
  );
}
