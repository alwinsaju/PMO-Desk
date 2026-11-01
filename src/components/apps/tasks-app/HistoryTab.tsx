"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwiseIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { Button, EmptyState, Input } from "@/components/ui";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { explainFailure } from "@/lib/tasks/failureExplainer";
import { byPriority, sparkline } from "@/lib/tasks/inputCheck";
import {
  durationMs,
  filterRuns,
  formatDuration,
  NO_FILTER,
  summarizeRuns,
  type HistoryFilter,
} from "@/lib/tasks/runHistory";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { fetchTaskHistory } from "./api";
import type { HistoryRun, Task } from "./types";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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
  const [open, setOpen] = useState<string | null>(null);
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
        <ul className="flex flex-col gap-2">
          {shown.map((run) => {
            const key = `${run.task_id}:${run.run_id}`;
            const failed = run.outcome === "failed";
            const help = failed
              ? explainFailure(run.error, run.current_step_at_end)
              : null;
            return (
              <li
                key={key}
                data-testid="history-row"
                className="border-line bg-card rounded-card border px-4 py-3"
              >
                <button
                  type="button"
                  className="focus-visible:ring-focus flex w-full items-center gap-3 text-left outline-none focus-visible:ring-2"
                  aria-expanded={open === key}
                  onClick={() => setOpen(open === key ? null : key)}
                >
                  <span
                    className={`rounded-chip px-2 py-0.5 text-[11px] font-bold ${failed ? "bg-red-soft text-red" : "bg-success-soft text-success"}`}
                  >
                    {failed ? "Failed" : "Completed"}
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                    {run.task_name ?? run.task_id}
                  </span>
                  <span className="text-ink-muted shrink-0 text-[12px]">
                    {when(run.ended_at)} · {formatDuration(durationMs(run))}
                  </span>
                </button>
                {open === key && (
                  <div className="mt-2.5 flex flex-col gap-1.5 text-[12.5px]">
                    {help && (
                      <>
                        <p className="text-red font-semibold">{help.title}</p>
                        <ol className="text-ink list-decimal pl-5">
                          {help.steps.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ol>
                        <p className="text-ink-muted font-mono text-[11.5px]">
                          {help.technical}
                        </p>
                      </>
                    )}
                    <p className="text-ink-muted">
                      Steps finished: {run.steps_completed.join(", ") || "none"}
                    </p>
                    {(run.approvals ?? []).length > 0 ? (
                      <ul className="text-ink-soft">
                        {(run.approvals ?? []).map((a) => (
                          <li key={`${a.step}-${a.at}`}>
                            {a.kind === "send" ? "Confirmed" : "Approved"} “{a.step}” by{" "}
                            {a.user} at {when(a.at)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-ink-muted">
                        No approvals were needed on this run.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
