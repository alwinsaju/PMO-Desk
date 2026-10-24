"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState, QuarantineRecord } from "@/lib/pmo/types";
import { updateConfig } from "./api";
import { CONTENT_WIDTH, Chip, PILL_STRIP, PanelMessage } from "./parts";
import {
  SOURCE_LABEL,
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
      <div className="bg-surface-elevated border-border sticky top-0 z-10 border-b">
        <div
          className={cn(CONTENT_WIDTH, PILL_STRIP, "px-3 py-2 @md:px-4")}
          role="group"
          aria-label="Filter by reason"
        >
          <ReasonPill active={active === null} onClick={() => onReasonChange(null)}>
            All
            <span className="text-ink-faint ml-1 tabular-nums">
              {state.filtered.length}
            </span>
          </ReasonPill>
          {counts.map((entry) => (
            <ReasonPill
              key={entry.code}
              active={active === entry.code}
              onClick={() => onReasonChange(entry.code)}
            >
              {entry.label}
              <span className="text-ink-faint ml-1 tabular-nums">{entry.count}</span>
            </ReasonPill>
          ))}
        </div>
      </div>

      <div className={cn(CONTENT_WIDTH, "flex flex-col gap-2.5 p-3 @md:p-4")}>
        <p className="text-ink-muted text-[12px] leading-relaxed">
          {state.ingest.filteredCount} message
          {state.ingest.filteredCount === 1 ? "" : "s"} kept out of the review queue.
          <span className="text-ink-faint"> {WHY_NO_BODY}</span>
        </p>
        {shown.map((record) => (
          <FilteredRow
            key={record.id}
            record={record}
            state={state}
            onSettled={onSettled}
            onOpenSettings={onOpenSettings}
          />
        ))}
      </div>
    </div>
  );
}

function ReasonPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-pill ease-standard shrink-0 px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors duration-150",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        active ? "bg-neutral-150 text-ink" : "text-ink-muted hover:bg-neutral-100",
      )}
    >
      {children}
    </button>
  );
}

function FilteredRow({
  record,
  state,
  onSettled,
  onOpenSettings,
}: {
  record: QuarantineRecord;
  state: PmoState;
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
    <article className="border-border bg-surface-elevated flex min-w-0 flex-col gap-1.5 rounded-2xl border px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-ink min-w-0 flex-1 truncate text-[14px] font-semibold">
          {summary.subject || "(no subject)"}
        </span>
        <span className="text-ink-faint shrink-0 text-[11px]">
          {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
        </span>
      </div>
      <p className="text-ink-muted truncate text-[12px]">
        {SOURCE_LABEL[summary.source]}
        {" · "}
        {summary.senderName ?? "Unknown sender"}
        {summary.senderAddress ? ` <${summary.senderAddress}>` : ""}
      </p>
      <p className="text-ink text-[12px] break-words">
        <Chip tone="outline" className="mr-1.5 align-middle">
          {reasonLabel(record.code)}
        </Chip>
        {record.reason}
      </p>
      <p className="text-ink-muted text-[12px] leading-relaxed">{guidance.steps}</p>
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
              className="text-ink-faint min-w-0 truncate font-mono text-[11px]"
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
        <p role="status" className="text-ink-muted text-[12px] break-words">
          {note}
        </p>
      )}
    </article>
  );
}
