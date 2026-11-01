"use client";

import { memo, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState, Proposal, StructuringInfo } from "@/lib/pmo/types";
import { rejectProposal, restoreProposal } from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  ErrorLine,
  GUTTER_X,
  PanelMessage,
  ProposalStatusBadge,
  ROW_CARD,
  ScrollBody,
  SectionLabel,
  SourceBadge,
} from "./parts";
import { ProposalReview } from "./ProposalReview";
import { FALLBACK_LABEL, groupQueue, rejectedRows, type QueueGroups } from "./queueView";
import { resolveSelection, reviewRowView, type ReviewLayout } from "./reviewPaneView";
import { UpdateCard } from "./UpdateCard";

interface ReviewQueueProps {
  state: PmoState;
  /** "pane": the list with the review beside it. "dialog": the list only; a
   *  row opens the review in a dialog (`onOpen`). */
  layout: ReviewLayout;
  /** Whether the collapsed "Probably not a task" section is open. Kept by the
   *  window so it survives a tab switch. */
  notTaskOpen: boolean;
  onNotTaskOpenChange: (open: boolean) => void;
  onOpen: (proposalId: string) => void;
  /** Open a to-do (from an update card). */
  onOpenTodo: (todoId: string) => void;
  onSettled: () => void;
  /** A row was rejected from the list: the window offers an Undo. */
  onRejected?: (proposal: Proposal) => void;
}

export function ReviewQueue({
  state,
  layout,
  notTaskOpen,
  onNotTaskOpenChange,
  onOpen,
  onOpenTodo,
  onSettled,
  onRejected,
}: ReviewQueueProps) {
  const groups = groupQueue(state.queue);
  // Whole minutes: the rows only say "5 min ago", so they need not redraw every poll.
  const nowMs = Math.floor(Date.parse(state.serverTime) / 60_000) * 60_000;
  const rejected = rejectedRows(state.rejected, nowMs);
  const pane = layout === "pane";

  // The row shown in the review pane. When it is approved or rejected the row
  // that took its place is selected next, so a run of approvals needs no clicks.
  const order = [
    ...groups.review,
    ...groups.processing,
    ...groups.failed,
    ...(notTaskOpen ? groups.notTask : []),
  ].map((p) => p.id);
  const [chosen, setChosen] = useState<{ id: string | null; index: number }>({
    id: null,
    index: 0,
  });
  const selectedId = resolveSelection(order, chosen.id, chosen.index);
  const selectedIndex = selectedId === null ? -1 : order.indexOf(selectedId);
  if (
    selectedId !== chosen.id ||
    (selectedIndex >= 0 && selectedIndex !== chosen.index)
  ) {
    setChosen({
      id: selectedId,
      index: selectedIndex >= 0 ? selectedIndex : chosen.index,
    });
  }
  const selected = pane ? state.queue.find((p) => p.id === selectedId) : undefined;

  if (state.queue.length === 0 && rejected.length === 0) {
    return (
      <PanelMessage className="h-full">
        Nothing to review. Messages that reach the inbox folder show up here as proposals;
        nothing becomes a to-do until you approve it.
      </PanelMessage>
    );
  }

  const sections = (
    <QueueSections
      groups={groups}
      state={state}
      nowMs={nowMs}
      rejected={rejected}
      selectedId={pane ? selectedId : null}
      notTaskOpen={notTaskOpen}
      onNotTaskOpenChange={onNotTaskOpenChange}
      onSelect={pane ? (id) => setChosen({ id, index: order.indexOf(id) }) : onOpen}
      onOpenTodo={onOpenTodo}
      onSettled={onSettled}
      onRejected={onRejected}
    />
  );

  if (!pane) {
    return (
      <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-6 pt-1 pb-6")}>
        {sections}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4 px-4 pt-1 pb-4" data-testid="review-panes">
      <ScrollBody
        memoryKey="pmo:review-list"
        aria-label="Review queue"
        className="-ml-1 flex-none basis-88 pr-2 pl-1"
      >
        <div className="flex flex-col gap-6 pb-2">{sections}</div>
      </ScrollBody>
      <section
        aria-label="Review"
        className="border-line bg-surface-elevated rounded-card flex min-h-0 min-w-0 flex-1 flex-col border p-5"
      >
        {selected ? (
          <ProposalReview
            key={selected.id}
            surface="pane"
            proposal={selected}
            structuring={state.structuring}
            runtime={state.runtime}
            onSettled={onSettled}
            onRejected={onRejected}
            onFinished={() => undefined}
          />
        ) : (
          <PanelMessage className="flex-1">
            Nothing is waiting for your review. Pick a message in the list to read it.
          </PanelMessage>
        )}
      </section>
    </div>
  );
}

/** Every group of the queue, as headed lists of rows. */
function QueueSections({
  groups,
  state,
  nowMs,
  rejected,
  selectedId,
  notTaskOpen,
  onNotTaskOpenChange,
  onSelect,
  onOpenTodo,
  onSettled,
  onRejected,
}: {
  groups: QueueGroups;
  state: PmoState;
  nowMs: number;
  rejected: ReturnType<typeof rejectedRows>;
  selectedId: string | null;
  notTaskOpen: boolean;
  onNotTaskOpenChange: (open: boolean) => void;
  onSelect: (proposalId: string) => void;
  onOpenTodo: (todoId: string) => void;
  onSettled: () => void;
  onRejected?: (proposal: Proposal) => void;
}) {
  const { structuring } = state;
  const nothingElse =
    groups.updates.length +
      groups.review.length +
      groups.processing.length +
      groups.failed.length ===
    0;
  const row = (p: Proposal, onDismiss?: (rejected: Proposal | null) => void) => (
    <Row
      key={p.id}
      proposal={p}
      structuring={structuring}
      nowMs={nowMs}
      selected={p.id === selectedId}
      onOpen={onSelect}
      onDismiss={onDismiss}
    />
  );

  return (
    <>
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
        {groups.review.map((p) => row(p))}
      </Section>
      <Section title="Waiting for the model" count={groups.processing.length}>
        {groups.processing.map((p) => row(p))}
      </Section>
      <Section title="Failed" count={groups.failed.length}>
        {groups.failed.map((p) => row(p))}
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
            groups.notTask.map((p) =>
              row(p, (rejectedProposal) => {
                if (rejectedProposal) onRejected?.(rejectedProposal);
                onSettled();
              }),
            )}
        </div>
      )}
      <RejectedSection rows={rejected} onSettled={onSettled} />
    </>
  );
}

/** Rejected proposals still on disk, collapsed: each can be put back in the queue. */
function RejectedSection({
  rows,
  onSettled,
}: {
  rows: ReturnType<typeof rejectedRows>;
  onSettled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function restore(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const reply = await restoreProposal(id);
      if (!reply.ok) setError(reply.reason);
      onSettled();
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-ink-muted hover:text-ink focus-visible:ring-focus flex items-center gap-1.5 self-start rounded text-[11px] font-bold tracking-[0.08em] uppercase outline-none focus-visible:ring-2"
      >
        {open ? (
          <CaretDownIcon size={12} weight="bold" />
        ) : (
          <CaretRightIcon size={12} weight="bold" />
        )}
        Rejected
        <CountBubble>{rows.length}</CountBubble>
      </button>
      {open && error && <ErrorLine>{error}</ErrorLine>}
      {open &&
        rows.map((row) => (
          <div
            key={row.id}
            className={cn(ROW_CARD, "flex min-h-14 items-center gap-3 pr-3 pl-4")}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
              <span className="text-ink block truncate text-[14px] font-semibold">
                {row.title}
              </span>
              <span className="text-ink-muted block truncate text-[12.5px]">
                {row.when}
                {row.reason ? ` · ${row.reason}` : ""}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={busyId !== null}
              onClick={() => void restore(row.id)}
            >
              Restore
            </Button>
          </div>
        ))}
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

/** One message: where it came from, its subject, a line on what it asks for,
 *  when it arrived, and the things a reviewer should know before opening it. */
const Row = memo(function Row({
  proposal,
  structuring,
  nowMs,
  selected,
  onOpen,
  onDismiss,
}: {
  proposal: Proposal;
  structuring: StructuringInfo;
  nowMs: number;
  /** The row whose review is open beside the list. */
  selected: boolean;
  onOpen: (id: string) => void;
  /** Present on the "probably not a task" rows: one-click Dismiss; gets the
   *  proposal that was rejected, or null when the server refused. */
  onDismiss?: (rejected: Proposal | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const view = reviewRowView(proposal, nowMs);
  const hasChips =
    view.fellBack ||
    view.checkOriginal ||
    view.replyBelowQuote ||
    view.duplicate ||
    view.part !== null ||
    view.showStatus;

  return (
    <div
      className={cn(
        ROW_CARD,
        "flex items-center gap-2 pr-3 pl-4",
        selected && "border-accent bg-accent-soft",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(proposal.id)}
        aria-current={selected ? "true" : undefined}
        className="focus-visible:ring-focus rounded-control flex min-w-0 flex-1 items-start gap-3 py-3 text-left outline-none focus-visible:ring-2"
      >
        <SourceBadge source={proposal.summary.source} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-ink min-w-0 flex-1 truncate text-[14.5px] font-semibold">
              {view.title}
            </span>
            <span className="text-ink-muted shrink-0 text-[12px]">{view.when}</span>
          </span>
          {view.summary && (
            <span className="text-ink-soft block truncate text-[13px]">
              {view.summary}
            </span>
          )}
          <span className="text-ink-muted block truncate text-[12px]">{view.sender}</span>
          {hasChips && (
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {view.fellBack && (
                <Chip tone="warning" className="gap-1" title="Check every field">
                  <WarningIcon size={11} weight="fill" />
                  {FALLBACK_LABEL}
                </Chip>
              )}
              {view.checkOriginal && (
                <Chip
                  tone="warning"
                  className="gap-1"
                  title="The sentence the model quoted was not found in the message"
                >
                  <WarningIcon size={11} weight="fill" />
                  Check original
                </Chip>
              )}
              {view.replyBelowQuote && (
                <Chip title="The sender's text sat under the quoted mail, and was kept">
                  Reply below quote
                </Chip>
              )}
              {view.duplicate && (
                <Chip title="Looks like another task from the same message, but is not identical">
                  Possible duplicate
                </Chip>
              )}
              {view.part && <Chip>{view.part}</Chip>}
              {view.showStatus && (
                <ProposalStatusBadge proposal={proposal} structuring={structuring} />
              )}
            </span>
          )}
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
              const reply = await rejectProposal(proposal.id);
              onDismiss(reply.ok ? proposal : null);
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
