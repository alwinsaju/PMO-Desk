"use client";

import { useState } from "react";
import {
  HISTORY_MAX_ENTRIES,
  describeEntry,
  type HistoryEntry,
} from "@/lib/registers/history";
import type { RegisterDef } from "@/lib/registers/types";

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; entries: HistoryEntry[] }
  | { state: "failed" };

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/** A small, collapsed "History" list for one saved record: which fields changed and when (never the
 *  values). An append-only local log; it is loaded only when opened and never blocks the dialog. */
export function RecordHistory({ def, recordId }: { def: RegisterDef; recordId: string }) {
  const [load, setLoad] = useState<Load>({ state: "idle" });

  const fetchHistory = async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch(
        `/api/registers/${encodeURIComponent(def.id)}/history?record=${encodeURIComponent(recordId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
      );
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        entries?: HistoryEntry[];
      } | null;
      if (body?.ok && Array.isArray(body.entries)) {
        setLoad({ state: "ready", entries: body.entries });
      } else setLoad({ state: "failed" });
    } catch {
      setLoad({ state: "failed" });
    }
  };

  return (
    <details
      className="border-line mt-3 rounded-md border px-3 py-2"
      data-testid="record-history"
      onToggle={(e) => {
        if (e.currentTarget.open && load.state === "idle") void fetchHistory();
      }}
    >
      <summary className="text-ink-muted cursor-pointer text-[11.5px] font-bold tracking-[0.06em] uppercase">
        History
      </summary>
      <div className="mt-2 text-[12.5px]">
        {load.state === "loading" && <p className="text-ink-muted">Loading…</p>}
        {load.state === "failed" && (
          <p className="text-ink-muted">The history could not be read.</p>
        )}
        {load.state === "ready" && load.entries.length === 0 && (
          <p className="text-ink-muted">
            No history yet. Changes made from now on are listed here.
          </p>
        )}
        {load.state === "ready" && load.entries.length > 0 && (
          <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto">
            {load.entries.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2">
                <span className="text-ink-muted shrink-0">{when(e.at)}</span>
                <span className="text-ink">{describeEntry(def, e)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-ink-muted mt-2 text-[11.5px]">
          An append-only list kept on this computer. It records which fields changed, not
          what they were. The newest {HISTORY_MAX_ENTRIES} changes per tool are kept.
        </p>
      </div>
    </details>
  );
}
