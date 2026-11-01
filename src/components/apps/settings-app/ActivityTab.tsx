"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { actorLabel } from "@/lib/platform/auditReadable";
import {
  actionCounts,
  actionLabel,
  auditRows,
  filterAudit,
  type AuditEntry,
} from "@/lib/platform/auditView";
import { toCsv } from "@/lib/staff/exportFiles";
import { fetchAudit } from "./platformApi";
import { Note, Section, when } from "./SettingsParts";

const SHOWN = 200;

/** Settings > Activity: the PMO audit log in plain words, newest first. Read only. */
export function ActivityTab() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<{ reason: string; detail?: string } | null>(null);
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [technical, setTechnical] = useState(false);

  const load = async () => {
    setError(null);
    const reply = await fetchAudit();
    if (reply.ok) {
      setEntries(reply.entries);
      setTotal(reply.total);
    } else setError({ reason: reply.reason, detail: reply.detail });
  };
  useEffect(() => {
    void (async () => {
      const reply = await fetchAudit();
      if (reply.ok) {
        setEntries(reply.entries);
        setTotal(reply.total);
      } else setError({ reason: reply.reason, detail: reply.detail });
    })();
  }, []);

  const actions = useMemo(() => actionCounts(entries ?? []), [entries]);
  const shown = useMemo(
    () => filterAudit(entries ?? [], { action: action || undefined, query }),
    [entries, action, query],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(auditRows(shown)));
      toast({ tone: "success", message: `Copied ${shown.length} lines as CSV.` });
    } catch {
      toast({ tone: "danger", message: "Could not copy to the clipboard." });
    }
  };

  return (
    <Section title="Everything AI OS did on your behalf">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search activity"
          {...noSpellcheck}
          placeholder="Search activity"
          className="border-line bg-chip text-ink rounded-control min-w-40 flex-1 border px-3 py-2 text-[13.5px] outline-none"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
          className="border-line bg-chip text-ink rounded-control border px-2 py-2 text-[13px]"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {actionLabel(a.action)} ({a.count})
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={technical}
          onClick={() => setTechnical((on) => !on)}
        >
          {technical ? "Hide technical details" : "Show technical details"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={shown.length === 0}
          onClick={() => void copy()}
        >
          Copy as CSV
        </Button>
      </div>
      {error && (
        <Note tone="error" detail={error.detail}>
          {error.reason}
        </Note>
      )}
      {entries === null && !error && <Note>Reading the log…</Note>}
      {entries && entries.length === 0 && (
        <p className="text-ink-muted py-2 text-[13px]">
          Nothing has been recorded yet. Approving a to-do or saving a report adds a line.
        </p>
      )}
      {entries && entries.length > 0 && (
        <>
          <ul className="divide-line divide-y" aria-label="Activity">
            {shown.slice(0, SHOWN).map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex items-baseline gap-3 py-2 text-[13px]"
              >
                <span className="text-ink-muted w-28 shrink-0 text-[12px]">
                  {when(entry.at)}
                </span>
                <span className="min-w-0 flex-1" title={entry.details.join(" · ")}>
                  <span className="text-ink font-medium">
                    {actionLabel(entry.action)}
                  </span>
                  {entry.readable.length > 0 && (
                    <span className="text-ink-muted block truncate text-[12px]">
                      {entry.readable.join(" · ")}
                    </span>
                  )}
                  {technical && entry.details.length > 0 && (
                    <span className="text-ink-faint block font-mono text-[11.5px] break-all">
                      {entry.details.join(" · ")}
                    </span>
                  )}
                </span>
                <span
                  className="text-ink-muted shrink-0 text-[12px]"
                  title={
                    entry.user ? `Recorded under the account "${entry.user}"` : undefined
                  }
                >
                  {actorLabel(entry.user)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted pt-3 text-[12.5px]">
            {shown.length === 0
              ? "No line matches."
              : `Showing ${Math.min(shown.length, SHOWN)} of ${shown.length} matching lines (${total} kept in all).`}
          </p>
        </>
      )}
    </Section>
  );
}
