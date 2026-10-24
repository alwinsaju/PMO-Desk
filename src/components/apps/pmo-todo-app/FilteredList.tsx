"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState, QuarantineRecord } from "@/lib/pmo/types";
import { updateConfig } from "./api";
import {
  CONTENT_WIDTH,
  Chip,
  FilterPill,
  GUTTER_X,
  PILL_STRIP,
  PanelMessage,
  ROW_CARD,
  STICKY_BAR,
  SourceBadge,
} from "./parts";
import {
  WHY_NO_BODY,
  filterByReason,
  reasonCounts,
  reasonLabel,
  relativeTime,
  resendGuidance,
} from "./queueView";

interface FilteredListProps {
  state: PmoState;
  /** The reason filter (null = all). Kept by the window so it survives a tab switch. */
  reason: string | null;
  onReasonChange: (reason: string | null) => void;
  onSettled: () => void;
  onOpenSettings: () => void;
}

/** Everything the Deloitte-only filter held back: metadata and the reason,
 *  never the message text, so nothing vanishes silently. A filtered message
 *  cannot be moved into the review queue (its text is gone by design); what a
 *  row offers instead is the one-click rule change and the steps to send it
 *  again. */
export function FilteredList({
  state,
  reason,
  onReasonChange,
  onSettled,
  onOpenSettings,
}: FilteredListProps) {
  const counts = reasonCounts(state.filtered);
  // A reason that no longer occurs (its items were cleared) falls back to All.
  const active = reason !== null && counts.some((c) => c.code === reason) ? reason : null;
  const shown = filterByReason(state.filtered, active);

  if (state.filtered.length === 0) {
    return (
      <PanelMessage className="h-full">
        Nothing has been filtered. Messages from outside the allowed Deloitte senders, or
        from a blocked domain, would be listed here with the reason.
      </PanelMessage>
    );
  }
  return (
    <div className="flex flex-col">
      <div className={STICKY_BAR}>
        <div
          className={cn(CONTENT_WIDTH, GUTTER_X, PILL_STRIP, "py-2.5")}
          role="group"
          aria-label="Filter by reason"
        >
          <FilterPill
            active={active === null}
            count={state.filtered.length}
            onClick={() => onReasonChange(null)}
          >
            All
          </FilterPill>
          {counts.map((entry) => (
            <FilterPill
              key={entry.code}
              active={active === entry.code}
              count={entry.count}
              onClick={() => onReasonChange(entry.code)}
            >
              {entry.label}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className={cn(CONTENT_WIDTH, GUTTER_X, "flex flex-col gap-2.5 pt-3.5 pb-6")}>
        <p className="text-ink-muted text-[12.5px] leading-relaxed">
          {state.ingest.filteredCount} message
          {state.ingest.filteredCount === 1 ? "" : "s"} kept out of the review queue.
          <span className="text-ink-muted"> {WHY_NO_BODY}</span>
        </p>
        {shown.map((record, index) => (
          <FilteredRow
            key={record.id}
            record={record}
            state={state}
            index={index}
            onSettled={onSettled}
            onOpenSettings={onOpenSettings}
          />
        ))}
      </div>
    </div>
  );
}

function FilteredRow({
  record,
  state,
  index,
  onSettled,
  onOpenSettings,
}: {
  record: QuarantineRecord;
  state: PmoState;
  /** Position in the list; only staggers the entrance animation. */
  index: number;
  onSettled: () => void;
  onOpenSettings: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { summary } = record;
  const guidance = resendGuidance(record, state.config);

  async function allow(
    patch: { allowedTenantIds: string[] } | { allowedSenderDomains: string[] },
    done: string,
  ) {
    setBusy(true);
    try {
      const reply = await updateConfig(patch);
      setNote(reply.ok ? done : reply.reason);
      onSettled();
    } catch {
      setNote("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={cn(ROW_CARD, "flex flex-col gap-2 px-4 py-3")}
    >
      <div className="flex min-h-10 items-center gap-3.5">
        <SourceBadge source={summary.source} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ink block truncate text-[14.5px] font-semibold">
            {summary.subject || "(no subject)"}
          </span>
          <span className="text-ink-muted block truncate text-[12.5px]">
            {summary.senderName ?? "Unknown sender"}
            {summary.senderAddress ? ` <${summary.senderAddress}>` : ""}
            {" · "}
            {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
          </span>
        </div>
        <Chip tone="neutral" fixedWidth={176} className="hidden shrink-0 @md:inline-flex">
          {reasonLabel(record.code)}
        </Chip>
      </div>
      <p className="text-ink text-[13px] break-words">{record.reason}</p>
      <p className="text-ink-muted text-[12.5px] leading-relaxed">{guidance.steps}</p>
      <div className="flex flex-wrap items-center gap-2">
        {guidance.allowTenantId && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                void allow(
                  {
                    allowedTenantIds: [
                      ...state.config.allowedTenantIds,
                      guidance.allowTenantId as string,
                    ],
                  },
                  "Tenant allowed. Run the Teams flow on this message again and it will be picked up on the next scan.",
                )
              }
            >
              Allow this tenant
            </Button>
            <span
              className="text-ink-muted min-w-0 truncate font-mono text-[11.5px]"
              title={guidance.allowTenantId}
            >
              {guidance.allowTenantId}
            </span>
          </>
        )}
        {guidance.allowDomain && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() =>
              void allow(
                {
                  allowedSenderDomains: [
                    ...state.config.allowedSenderDomains,
                    guidance.allowDomain as string,
                  ],
                },
                `${guidance.allowDomain} allowed. Send the email again (flag it again, or run the Outlook export with -IgnoreSeen).`,
              )
            }
          >
            Allow {guidance.allowDomain}
          </Button>
        )}
        {!guidance.allowTenantId && !guidance.allowDomain && (
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Open settings
          </Button>
        )}
      </div>
      {note && (
        <p role="status" className="text-ink-soft text-[12.5px] font-medium break-words">
          {note}
        </p>
      )}
    </article>
  );
}
