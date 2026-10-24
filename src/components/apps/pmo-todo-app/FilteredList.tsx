"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState, QuarantineRecord } from "@/lib/pmo/types";
import { updateConfig } from "./api";
import { SourceBadge } from "./parts";
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
  onSettled: () => void;
  onOpenSettings: () => void;
}

/** Everything the Deloitte-only filter held back: metadata and the reason,
 *  never the message text, so nothing vanishes silently. A filtered message
 *  cannot be moved into the review queue (its text is gone by design); what a
 *  row offers instead is the one-click rule change and the steps to send it
 *  again. */
export function FilteredList({ state, onSettled, onOpenSettings }: FilteredListProps) {
  const [reason, setReason] = useState<string | null>(null);
  const counts = reasonCounts(state.filtered);
  // A reason that no longer occurs (its items were cleared) falls back to All.
  const active = reason !== null && counts.some((c) => c.code === reason) ? reason : null;
  const shown = filterByReason(state.filtered, active);

  if (state.filtered.length === 0) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center p-6 text-center">
        <p className="text-ink-faint max-w-sm text-sm">
          Nothing has been filtered. Messages from outside the allowed Deloitte senders,
          or from a blocked domain, would be listed here with the reason.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-ink-muted text-[12px]">
          {state.ingest.filteredCount} message
          {state.ingest.filteredCount === 1 ? "" : "s"} kept out of the review queue.
        </p>
        <p className="text-ink-faint text-[11px] leading-relaxed">{WHY_NO_BODY}</p>
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Filter by reason"
      >
        <ReasonPill active={active === null} onClick={() => setReason(null)}>
          All ({state.filtered.length})
        </ReasonPill>
        {counts.map((entry) => (
          <ReasonPill
            key={entry.code}
            active={active === entry.code}
            onClick={() => setReason(entry.code)}
          >
            {entry.label} ({entry.count})
          </ReasonPill>
        ))}
      </div>

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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-pill ease-standard px-3 py-1 text-[12px] font-medium transition-colors duration-150",
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
    <div className="border-border/60 bg-surface-elevated flex flex-col gap-1.5 rounded-2xl border p-3">
      <div className="flex items-center gap-2">
        <SourceBadge source={summary.source} />
        <span className="text-ink min-w-0 flex-1 truncate text-[14px] font-semibold">
          {summary.subject || "(no subject)"}
        </span>
        <span className="text-ink-faint shrink-0 text-[11px]">
          {relativeTime(summary.receivedAt, Date.parse(state.serverTime))}
        </span>
      </div>
      <p className="text-ink-muted truncate text-[12px]">
        {summary.senderName ?? "Unknown sender"}
        {summary.senderAddress ? ` <${summary.senderAddress}>` : ""}
      </p>
      <p className="text-ink text-[12px]">
        <span className="text-ink-faint">{reasonLabel(record.code)}: </span>
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
            <span className="text-ink-faint truncate font-mono text-[11px]">
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
      {note && <p className="text-ink-muted text-[12px]">{note}</p>}
    </div>
  );
}
