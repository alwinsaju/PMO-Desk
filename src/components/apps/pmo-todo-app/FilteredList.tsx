"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { PmoState, QuarantineRecord } from "@/lib/pmo/types";
import { updateConfig } from "./api";
import { SourceBadge } from "./parts";
import { relativeTime } from "./queueView";

interface FilteredListProps {
  state: PmoState;
  onSettled: () => void;
}

/** Everything the Deloitte-only filter held back: metadata and the reason,
 *  never the message text, so nothing vanishes silently. */
export function FilteredList({ state, onSettled }: FilteredListProps) {
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
      <p className="text-ink-muted text-[12px]">
        {state.ingest.filteredCount} message{state.ingest.filteredCount === 1 ? "" : "s"}{" "}
        kept out of the review queue. Their text was not stored.
      </p>
      {state.filtered.map((record) => (
        <FilteredRow
          key={record.id}
          record={record}
          state={state}
          onSettled={onSettled}
        />
      ))}
    </div>
  );
}

function FilteredRow({
  record,
  state,
  onSettled,
}: {
  record: QuarantineRecord;
  state: PmoState;
  onSettled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { summary } = record;
  const canAllowTenant =
    summary.source === "teams" &&
    record.tenantId !== null &&
    !state.config.allowedTenantIds.includes(record.tenantId.toLowerCase());

  async function allowTenant() {
    if (!record.tenantId) return;
    setBusy(true);
    try {
      const reply = await updateConfig({
        allowedTenantIds: [...state.config.allowedTenantIds, record.tenantId],
      });
      setNote(
        reply.ok
          ? "Tenant allowed. Send this message from Teams again and it will be picked up on the next scan."
          : reply.reason,
      );
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
      <p className="text-ink text-[12px]">{record.reason}</p>
      {canAllowTenant && (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void allowTenant()}
          >
            Allow this tenant
          </Button>
          <span className="text-ink-faint truncate font-mono text-[11px]">
            {record.tenantId}
          </span>
        </div>
      )}
      {note && <p className="text-ink-muted text-[12px]">{note}</p>}
    </div>
  );
}
