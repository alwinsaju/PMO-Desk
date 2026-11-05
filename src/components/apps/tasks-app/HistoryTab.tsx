"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwiseIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { Button, EmptyState, Input } from "@/components/ui";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { byPriority, sparkline } from "@/lib/tasks/inputCheck";
import {
  filterRuns,
  formatDuration,
  NO_FILTER,
  summarizeRuns,
  type HistoryFilter,
} from "@/lib/tasks/runHistory";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { fetchTaskHistory } from "./api";
import { HistoryTable } from "./HistoryTable";
import { historyRows } from "./historyRows";
import type { HistoryRun, Task } from "./types";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

/** Every task's past runs in one list: filter, see who approved what, and read a failure in plain words. */
export function HistoryTab({
  tasks,
  onOpenWorkflows,
}: {
  tasks: Task[];
  onOpenWorkflows: () => void;
}) {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  const snapshots = useTasksPrefs((s) => s.snapshots);

  const ids = tasks.map((t) => t.id).join(",");
  const load = useCallback(async () => {
    setLoading(true);
    const lists = await Promise.all(
      ids
        .split(",")
        .filter(Boolean)
        .map((id) => fetchTaskHistory(id).catch(() => [] as HistoryRun[])),
    );
    setRuns(lists.flat());
    setLoading(false);
  }, [ids]);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => filterRuns(runs, filter, new Date()), [runs, filter]);
  const rows = useMemo(() => historyRows(shown, tasks), [shown, tasks]);
  const summary = summarizeRuns(shown);
  const trends = useMemo(
    () =>
      tasks
        .map((t) => ({
          task: t,
          points: snapshots.filter((s) => s.taskId === t.id),
        }))
        .filter((x) => x.points.length >= 1),
    [tasks, snapshots],
  );

  return (
    <div className="flex flex-col gap-4 px-6 pt-2 pb-6" data-testid="history-tab">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Task"
          className={SELECT}
          value={filter.taskId ?? ""}
          onChange={(e) => setFilter({ ...filter, taskId: e.target.value || null })}
        >
          <option value="">All tasks</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Outcome"
          className={SELECT}
          value={filter.outcome}
          onChange={(e) =>
            setFilter({ ...filter, outcome: e.target.value as HistoryFilter["outcome"] })
          }
        >
          <option value="all">Any outcome</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Reset</option>
        </select>
        <select
          aria-label="Period"
          className={SELECT}
          value={filter.sinceDays ?? ""}
          onChange={(e) =>
            setFilter({
              ...filter,
              sinceDays: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <Input
          {...noSpellcheck}
          aria-label="Search runs"
          placeholder="Search runs"
          className="min-w-40 flex-1"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <ArrowClockwiseIcon size={14} />
          Refresh
        </Button>
      </div>

      {runs.length > 0 && (
        <p className="text-ink-muted text-[13px]" data-testid="history-summary">
          {summary.total} run{summary.total === 1 ? "" : "s"}
          {summary.successPercent !== null
            ? ` · ${summary.successPercent}% completed`
            : ""}
          {summary.failed ? ` · ${summary.failed} failed` : ""}
          {summary.medianMs !== null
            ? ` · typically ${formatDuration(summary.medianMs)}`
            : ""}
        </p>
      )}

      {trends.length > 0 && (
        <section
          aria-label="Trends"
          className="grid gap-3 sm:grid-cols-2"
          data-testid="trends"
        >
          {trends.map(({ task, points }) => {
            const values = points.map((p) => p.total);
            const line = sparkline(values, 160, 36);
            const latest = [...points].reverse().find((p) => p.rows.length > 0);
            return (
              <div
                key={task.id}
                className="border-line bg-card rounded-card border px-4 py-3"
              >
                <p className="text-ink text-[13px] font-semibold">{task.displayName}</p>
                <p className="text-ink-muted text-[12px]">
                  Incidents per run: {values.join(" → ")}
                </p>
                {line ? (
                  <svg
                    viewBox="0 0 160 36"
                    className="text-accent mt-1 h-9 w-40"
                    role="img"
                    aria-label={`Incident count over the last ${values.length} runs`}
                  >
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      points={line}
                    />
                  </svg>
                ) : (
                  <p className="text-ink-muted mt-1 text-[12px]">
                    Needs two runs to draw a line.
                  </p>
                )}
                {latest && (
                  <p className="text-ink-muted mt-1 text-[12px]">
                    By priority:{" "}
                    {byPriority(latest.rows)
                      .map((p) => `${p.priority} ${p.count}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {loading && runs.length === 0 ? (
        <p className="text-ink-muted text-[13px]">Reading run history…</p>
      ) : runs.length === 0 ? (
        <EmptyState
          data-testid="history-empty"
          icon={<ClockCounterClockwiseIcon size={22} />}
          headline="No runs yet"
          description="Each time a workflow runs, it is listed here with who approved it and how it went."
          action={
            <Button size="sm" onClick={onOpenWorkflows}>
              Go to Workflows
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          compact
          headline="No runs match these filters"
          action={
            <Button variant="outline" size="sm" onClick={() => setFilter(NO_FILTER)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <HistoryTable rows={rows} />
      )}
    </div>
  );
}
