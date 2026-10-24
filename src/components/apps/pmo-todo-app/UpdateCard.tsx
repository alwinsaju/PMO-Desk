"use client";

import { useMemo, useState } from "react";
import { ArrowRightIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MAX_AI_ATTEMPTS, type PmoState, type Proposal } from "@/lib/pmo/types";
import {
  UPDATE_KIND_LABEL,
  planUpdate,
  type SignoffSuggestion,
} from "@/lib/pmo/updateLogic";
import { applyUpdate, rejectProposal, retryProposal, separateUpdate } from "./api";
import { OriginalMessage } from "./OriginalMessage";
import { Chip, ProposalStatusBadge } from "./parts";
import { SOURCE_LABEL, relativeTime } from "./queueView";

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
          })
        : null,
    [todo, result, summary.senderName, summary.senderAddress, summary.receivedAt],
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
      className="border-border bg-surface-elevated flex min-w-0 flex-col gap-3 rounded-2xl border p-3.5 @md:p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="min-w-0 text-[14px] font-semibold">
          {todo ? (
            <button
              type="button"
              onClick={() => onOpenTodo(todo.id)}
              className="text-ink focus-visible:ring-accent line-clamp-2 rounded text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2"
              title="Open this to-do"
            >
              {todo.title}
            </button>
          ) : (
            <span className="text-ink line-clamp-2">{update.todoTitle}</span>
          )}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
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
              tone="outline"
              className="border-ink text-ink gap-1"
              title="The sentence the model quoted was not found in the message"
            >
              <WarningIcon size={11} weight="fill" />
              Check original
            </Chip>
          )}
          {!ready && (
            <ProposalStatusBadge proposal={proposal} structuring={state.structuring} />
          )}
          <span className="text-ink-muted min-w-0 truncate">
            Update from {sender}
            <span className="text-ink-faint">
              {" · "}
              {SOURCE_LABEL[summary.source]}
              {" · "}
              {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
              {summary.subject ? ` · ${summary.subject}` : ""}
            </span>
          </span>
        </p>
        {(todo?.waitingOn?.trim() || (todo && !open) || !todo) && (
          <p className="text-ink-faint text-[12px]">
            {todo?.waitingOn?.trim() ? `Waiting on ${todo.waitingOn}` : ""}
            {todo?.waitingOn?.trim() && todo && !open ? " · " : ""}
            {todo && !open ? todo.status : ""}
            {!todo ? "This to-do no longer exists." : ""}
          </p>
        )}
      </div>

      {(status === "pending" || status === "structuring") && (
        <p className="text-ink-muted text-[12px]">
          {state.structuring.paused
            ? "Waiting for the local model to come back; this will be read automatically."
            : "The local model is reading this message against the to-do (this can take a minute or two)."}
        </p>
      )}
      {status === "failed" && (
        <p className="border-border text-ink rounded-lg border bg-neutral-50 px-3 py-2 text-[12px] break-words">
          The local model could not read this message
          {proposal.ai.error ? ` (${proposal.ai.error.replace(/\.$/, "")})` : ""}.
          Attempts used: {proposal.ai.attempts} of {MAX_AI_ATTEMPTS}. Retry, or create it
          as a separate to-do.
        </p>
      )}

      {ready && result && plan && (
        <>
          {result.summary && (
            <p className="text-ink text-[13px] leading-relaxed">{result.summary}</p>
          )}
          {plan.changes.length === 0 ? (
            <p className="text-ink-muted text-[12px]">
              {nothing
                ? "Nothing actionable in this message."
                : "Nothing to change on the to-do."}{" "}
              Approving only links the message to the to-do&rsquo;s timeline.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Proposed changes">
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
                      className="accent-accent mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <label
                      htmlFor={`${proposal.id}-${change.id}`}
                      className="min-w-0 flex-1 text-[12px]"
                    >
                      <span className="text-ink-faint block text-[10px] font-semibold tracking-wide uppercase">
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
                              size={11}
                              className="text-ink-faint shrink-0"
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
                            "mt-0.5 block text-[11px]",
                            (change.kind === "waiting" && plan.replyFrom) ||
                              (change.kind === "signoff" && change.defaultOn)
                              ? "text-accent-800 dark:text-accent-300 font-medium"
                              : "text-ink-faint",
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
          className="text-ink-muted hover:text-ink focus-visible:ring-accent rounded text-[12px] underline-offset-2 outline-none hover:underline focus-visible:ring-2"
        >
          {showMessage ? "Hide the new message" : "Show the new message"}
        </button>
        {showMessage && (
          <div className="border-border mt-2 flex h-56 flex-col rounded-lg border p-3">
            <OriginalMessage
              intakeId={proposal.intakeId}
              quote={ready ? result?.signoffQuote || result?.quote : null}
              className="flex min-h-0 flex-1 flex-col"
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-ink text-[12px] font-medium">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="mr-auto"
          disabled={busy || status === "structuring"}
          onClick={() => void run(() => separateUpdate(proposal.id))}
        >
          Create as separate to-do instead
        </Button>
        {status === "failed" && proposal.ai.attempts < MAX_AI_ATTEMPTS && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => retryProposal(proposal.id))}
          >
            Retry
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => rejectProposal(proposal.id))}
        >
          {nothing ? "Dismiss" : "Reject"}
        </Button>
        {ready && (
          <Button
            size="sm"
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
      className="border-border flex flex-col gap-1 rounded-lg border bg-neutral-50 px-3 py-2 text-[12px]"
    >
      <p className="text-ink font-medium">
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
            <span className="text-ink font-medium">
              {" "}
              (not found in the message: check the original)
            </span>
          )}
        </p>
      )}
      {suggestion.guard && <p className="text-ink font-medium">{suggestion.guard}</p>}
      {unclear && (
        <p className="text-ink-faint">
          Nothing is recorded from this. Approving only links the message; record the
          sign-off yourself on the to-do if it was one.
          {onOpenTodo && (
            <>
              {" "}
              <button
                type="button"
                onClick={onOpenTodo}
                className="text-ink-muted hover:text-ink rounded underline underline-offset-2"
              >
                Open the to-do
              </button>
            </>
          )}
        </p>
      )}
      {!unclear && (
        <p className="text-ink-faint">
          If you tick the sign-off, this message becomes its evidence and your Windows
          user name and the time are stamped on it.
        </p>
      )}
    </div>
  );
}
