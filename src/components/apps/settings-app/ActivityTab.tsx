"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChatTextIcon,
  ClockIcon,
  ChartLineUpIcon,
  GearSixIcon,
  ListChecksIcon,
  SealCheckIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { actorLabel } from "@/lib/platform/auditReadable";
import {
  CATEGORY_LABEL,
  categoryCounts,
  categoryOf,
  filterByCategory,
  groupByDay,
  timeOfDay,
  type ActivityCategory,
} from "@/lib/platform/activityTimeline";
import {
  actionCounts,
  actionLabel,
  auditRows,
  filterAudit,
  type AuditEntry,
} from "@/lib/platform/auditView";
import { toCsv } from "@/lib/staff/exportFiles";
import { FilterPill } from "../pmo-todo-app/parts";
import { fetchAudit } from "./platformApi";
import { Note, Section } from "./SettingsParts";

const SHOWN = 200;

const CATEGORY_ICON: Record<ActivityCategory, Icon> = {
  todos: ListChecksIcon,
  messages: ChatTextIcon,
  signoff: SealCheckIcon,
  reports: ChartLineUpIcon,
  settings: GearSixIcon,
  other: ClockIcon,
};

/** Settings > Activity: the PMO audit log in plain words as a timeline, newest first. Read only. */
export function ActivityTab() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<{ reason: string; detail?: string } | null>(null);
  const [action, setAction] = useState("");
  const [category, setCategory] = useState<ActivityCategory | "">("");
  const [query, setQuery] = useState("");
  const [technical, setTechnical] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = async () => {
    setError(null);
    const reply = await fetchAudit();
    if (reply.ok) {
      setEntries(reply.entries);
      setTotal(reply.total);
      setNow(new Date());
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
  const categories = useMemo(() => categoryCounts(entries ?? []), [entries]);
  const shown = useMemo(
    () =>
      filterByCategory(
        filterAudit(entries ?? [], { action: action || undefined, query }),
        category,
      ),
    [entries, action, query, category],
  );
  const groups = useMemo(() => groupByDay(shown.slice(0, SHOWN), now), [shown, now]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(auditRows(shown)));
      toast({ tone: "success", message: `Copied ${shown.length} lines as CSV.` });
    } catch {
      toast({ tone: "danger", message: "Could not copy to the clipboard." });
    }
  };

  return (
    <Section title="Everything AI OS did on your behalf" settingId="activity-log">
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
          <ul className="flex flex-wrap gap-2 pb-3" aria-label="Filter by kind">
            <li>
              <FilterPill active={category === ""} onClick={() => setCategory("")}>
                All
              </FilterPill>
            </li>
            {categories.map((c) => (
              <li key={c.category}>
                <FilterPill
                  active={category === c.category}
                  count={c.count}
                  onClick={() => setCategory(c.category)}
                >
                  {CATEGORY_LABEL[c.category]}
                </FilterPill>
              </li>
            ))}
          </ul>
          <div aria-label="Activity" role="list">
            {groups.map((group) => (
              <div key={group.day} role="listitem" className="pb-3">
                <h3 className="text-ink-muted pb-1.5 text-[12px] font-bold tracking-[0.06em] uppercase">
                  {group.label}
                </h3>
                <ol className="border-line relative ml-4 flex flex-col gap-3 border-l pl-6">
                  {group.entries.map((entry, index) => {
                    const Glyph = CATEGORY_ICON[categoryOf(entry.action)];
                    return (
                      <li
                        key={`${entry.at}-${index}`}
                        className="relative flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]"
                      >
                        <span
                          aria-hidden
                          className="bg-accent-soft text-accent-ink border-card absolute top-0 -left-[calc(1.5rem+1rem)] grid h-8 w-8 place-items-center rounded-full border-4"
                        >
                          <Glyph size={15} weight="bold" />
                        </span>
                        <span className="text-ink-muted w-12 shrink-0 text-[12px] tabular-nums">
                          {timeOfDay(entry.at)}
                        </span>
                        <span
                          className="min-w-0 flex-1 basis-56"
                          title={entry.details.join(" · ")}
                        >
                          <span className="text-ink font-medium">
                            {actionLabel(entry.action)}
                          </span>
                          {entry.readable.length > 0 && (
                            <span className="text-ink-muted block text-[12px] break-words">
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
                            entry.user
                              ? `Recorded under the account "${entry.user}"`
                              : undefined
                          }
                        >
                          {actorLabel(entry.user)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
          <p className="text-ink-muted pt-1 text-[12.5px]">
            {shown.length === 0
              ? "No line matches."
              : `Showing ${Math.min(shown.length, SHOWN)} of ${shown.length} matching lines (${total} kept in all).`}
          </p>
        </>
      )}
    </Section>
  );
}
