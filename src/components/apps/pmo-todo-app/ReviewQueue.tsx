"use client";

import { useState } from "react";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Badge, Button } from "@/components/ui";
import type { PmoState, Proposal } from "@/lib/pmo/types";
import { rejectProposal } from "./api";
import { ProposalStatusBadge, SourceBadge } from "./parts";
import { groupQueue, relativeTime } from "./queueView";
import { UpdateCard } from "./UpdateCard";

interface ReviewQueueProps {
  state: PmoState;
  onOpen: (proposalId: string) => void;
  /** Open a to-do (from an update card). */
  onOpenTodo: (todoId: string) => void;
  onSettled: () => void;
}

export function ReviewQueue({ state, onOpen, onOpenTodo, onSettled }: ReviewQueueProps) {
  const [showNotTask, setShowNotTask] = useState(false);
  const groups = groupQueue(state.queue);
  const empty = state.queue.length === 0;

  if (empty) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center p-6 text-center">
        <p className="text-ink-faint max-w-sm text-sm">
          Nothing to review. Messages that reach the inbox folder show up here as
          proposals; nothing becomes a to-do until you approve it.
        </p>
      </div>
    );
  }

  const nothingElse =
    groups.updates.length +
      groups.review.length +
      groups.processing.length +
      groups.failed.length ===
    0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {nothingElse && (
        <p className="text-ink-faint py-4 text-center text-sm">
          Nothing needs your review right now.
        </p>
      )}
      <Section title="Updates to existing to-dos" count={groups.updates.length}>
        {groups.updates.map((p) => (
          <UpdateCard
            key={p.id}
            proposal={p}
            state={state}
            onOpenTodo={onOpenTodo}
            onSettled={onSettled}
          />
        ))}
      </Section>
      <Section title="Needs your review" count={groups.review.length}>
        {groups.review.map((p) => (
          <Row key={p.id} proposal={p} state={state} onOpen={onOpen} />
        ))}
      </Section>
      <Section title="Waiting for the model" count={groups.processing.length}>
        {groups.processing.map((p) => (
          <Row key={p.id} proposal={p} state={state} onOpen={onOpen} />
        ))}
      </Section>
      <Section title="Failed" count={groups.failed.length}>
        {groups.failed.map((p) => (
          <Row key={p.id} proposal={p} state={state} onOpen={onOpen} />
        ))}
      </Section>
      {groups.notTask.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowNotTask((open) => !open)}
            aria-expanded={showNotTask}
            className="text-ink-muted hover:text-ink flex items-center gap-1.5 self-start text-[12px] font-semibold tracking-wide uppercase"
          >
            {showNotTask ? (
              <CaretDownIcon size={12} weight="bold" />
            ) : (
              <CaretRightIcon size={12} weight="bold" />
            )}
            Probably not a task
            <Badge variant="outline">{groups.notTask.length}</Badge>
          </button>
          {showNotTask &&
            groups.notTask.map((p) => (
              <Row
                key={p.id}
                proposal={p}
                state={state}
                onOpen={onOpen}
                onDismiss={onSettled}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-ink-muted flex items-center gap-2 text-[12px] font-semibold tracking-wide uppercase">
        {title}
        <Badge variant="outline">{count}</Badge>
      </h3>
      {children}
    </div>
  );
}

function Row({
  proposal,
  state,
  onOpen,
  onDismiss,
}: {
  proposal: Proposal;
  state: PmoState;
  onOpen: (id: string) => void;
  /** Present on the "probably not a task" rows: one-click Dismiss. */
  onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { summary, draft } = proposal;
  const title = draft?.title || summary.subject || "(no subject)";
  const sender = summary.senderName ?? summary.senderAddress ?? "Unknown sender";

  return (
    <div className="border-border/60 bg-surface-elevated flex items-center gap-3 rounded-2xl border p-3">
      <button
        type="button"
        onClick={() => onOpen(proposal.id)}
        className="focus-visible:ring-accent flex min-w-0 flex-1 flex-col gap-1 rounded-lg text-left outline-none focus-visible:ring-2"
      >
        <span className="flex items-center gap-2">
          <SourceBadge source={summary.source} />
          <span className="text-ink min-w-0 truncate text-[14px] font-semibold">
            {title}
          </span>
        </span>
        <span className="text-ink-muted truncate text-[12px]">
          {sender}
          <span className="text-ink-faint">
            {" · "}
            {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
            {draft && title !== summary.subject && summary.subject
              ? ` · ${summary.subject}`
              : ""}
          </span>
        </span>
      </button>
      {proposal.status === "ready" && proposal.quoteVerified === false && (
        <Badge className="bg-ink text-ink-inverse shrink-0">check against original</Badge>
      )}
      <ProposalStatusBadge proposal={proposal} structuring={state.structuring} />
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await rejectProposal(proposal.id);
              onDismiss();
            } finally {
              setBusy(false);
            }
          }}
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}
