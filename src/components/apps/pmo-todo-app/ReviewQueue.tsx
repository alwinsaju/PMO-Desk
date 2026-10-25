"use client";

import { memo, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState, Proposal, StructuringInfo } from "@/lib/pmo/types";
import { rejectProposal } from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  GUTTER_X,
  PanelMessage,
  ProposalStatusBadge,
  ROW_CARD,
  SectionLabel,
  SourceBadge,
} from "./parts";
import { groupQueue, partLabel, relativeTime } from "./queueView";
import { UpdateCard } from "./UpdateCard";

interface ReviewQueueProps {
  state: PmoState;
  /** Whether the collapsed "Probably not a task" section is open. Kept by the
   *  window so it survives a tab switch. */
  notTaskOpen: boolean;
  onNotTaskOpenChange: (open: boolean) => void;
  onOpen: (proposalId: string) => void;
  /** Open a to-do (from an update card). */
  onOpenTodo: (todoId: string) => void;
  onSettled: () => void;
}

export function ReviewQueue({
  state,
  notTaskOpen,
  onNotTaskOpenChange,
  onOpen,
  onOpenTodo,
  onSettled,
}: ReviewQueueProps) {
  const groups = groupQueue(state.queue);

  if (state.queue.length === 0) {
    return (
      <PanelMessage className="h-full">
        Nothing to review. Messages that reach the inbox folder show up here as proposals;
        nothing becomes a to-do until you approve it.
      </PanelMessage>
    );
  }

  const nothingElse =
    groups.updates.length +
      groups.review.length +
      groups.processing.length +
      groups.failed.length ===
    0;
  // Whole minutes: the rows only say "5 min ago", so they need not redraw every poll.
  const nowMs = Math.floor(Date.parse(state.serverTime) / 60_000) * 60_000;
  const { structuring } = state;

  return (
    <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-6 pt-1 pb-6")}>
      {nothingElse && (
        <p className="text-ink-muted py-2 text-center text-[13.5px]">
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
          <Row
            key={p.id}
            proposal={p}
            structuring={structuring}
            nowMs={nowMs}
            onOpen={onOpen}
          />
        ))}
      </Section>
      <Section title="Waiting for the model" count={groups.processing.length}>
        {groups.processing.map((p) => (
          <Row
            key={p.id}
            proposal={p}
            structuring={structuring}
            nowMs={nowMs}
            onOpen={onOpen}
          />
        ))}
      </Section>
      <Section title="Failed" count={groups.failed.length}>
        {groups.failed.map((p) => (
          <Row
            key={p.id}
            proposal={p}
            structuring={structuring}
            nowMs={nowMs}
            onOpen={onOpen}
          />
        ))}
      </Section>
      {groups.notTask.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onNotTaskOpenChange(!notTaskOpen)}
            aria-expanded={notTaskOpen}
            className="text-ink-muted hover:text-ink focus-visible:ring-focus flex items-center gap-1.5 self-start rounded text-[11px] font-bold tracking-[0.08em] uppercase outline-none focus-visible:ring-2"
          >
            {notTaskOpen ? (
              <CaretDownIcon size={12} weight="bold" />
            ) : (
              <CaretRightIcon size={12} weight="bold" />
            )}
            Probably not a task
            <CountBubble>{groups.notTask.length}</CountBubble>
          </button>
          {notTaskOpen &&
            groups.notTask.map((p) => (
              <Row
                key={p.id}
                proposal={p}
                structuring={structuring}
                nowMs={nowMs}
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
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <SectionLabel className="flex items-center gap-2">
        {title}
        <CountBubble>{count}</CountBubble>
      </SectionLabel>
      {children}
    </section>
  );
}

/** The small count after a section name. */
function CountBubble({ children }: { children: ReactNode }) {
  return (
    <span className="bg-chip-strong text-ink-soft inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11.5px] leading-none font-semibold tracking-normal tabular-nums">
      {children}
    </span>
  );
}

const Row = memo(function Row({
  proposal,
  structuring,
  nowMs,
  onOpen,
  onDismiss,
}: {
  proposal: Proposal;
  structuring: StructuringInfo;
  nowMs: number;
  onOpen: (id: string) => void;
  /** Present on the "probably not a task" rows: one-click Dismiss. */
  onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { summary, draft } = proposal;
  const title = draft?.title || summary.subject || "(no subject)";
  const sender = summary.senderName ?? summary.senderAddress ?? "Unknown sender";
  const subject =
    draft && title !== summary.subject && summary.subject ? summary.subject : null;

  return (
    <div className={cn(ROW_CARD, "flex min-h-16 items-center gap-3 pr-3 pl-4")}>
      <button
        type="button"
        onClick={() => onOpen(proposal.id)}
        className="focus-visible:ring-focus rounded-control flex min-w-0 flex-1 items-center gap-3.5 py-3 text-left outline-none focus-visible:ring-2"
      >
        <SourceBadge source={summary.source} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ink block truncate text-[14.5px] font-semibold">
            {title}
          </span>
          <span className="text-ink-muted block truncate text-[12.5px]">
            {sender}
            {" · "}
            {relativeTime(summary.receivedAt, nowMs)}
            {partLabel(proposal) ? ` · ${partLabel(proposal)} from this message` : ""}
            {subject ? ` · ${subject}` : ""}
          </span>
        </span>
        {proposal.status === "ready" && proposal.quoteVerified === false && (
          <Chip
            tone="warning"
            className="shrink-0 gap-1"
            title="The sentence the model quoted was not found in the message"
          >
            <WarningIcon size={11} weight="fill" />
            Check original
          </Chip>
        )}
        <span className="flex shrink-0 justify-end @md:w-40">
          <ProposalStatusBadge proposal={proposal} structuring={structuring} />
        </span>
      </button>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
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
});
