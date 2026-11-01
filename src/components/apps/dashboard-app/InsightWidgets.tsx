"use client";

import {
  CalendarCheckIcon,
  ChartBarIcon,
  HeartbeatIcon,
  SealCheckIcon,
  SunIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  AGE_BUCKETS,
  type AgeBucket,
  type Health,
  type Pipeline,
  type TodayItem,
  type WeekCompare,
  type Workload,
} from "@/lib/dashboard/insights";
import { Empty, Widget } from "./widgets";

const Line = ({ children }: { children: React.ReactNode }) => (
  <li className="text-ink-soft text-[13px] leading-snug">{children}</li>
);

/** Everything that needs you today in one ordered list; each line opens the app behind it. */
export function TodayWidget({
  items,
  onOpen,
}: {
  items: TodayItem[];
  onOpen: (appId: TodayItem["appId"]) => void;
}) {
  return (
    <Widget
      title="Today"
      icon={SunIcon}
      count={items.length || undefined}
      testId="today-widget"
    >
      {items.length === 0 ? (
        <Empty>Nothing needs you right now.</Empty>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li key={`${item.kind}-${i}`}>
              <button
                type="button"
                onClick={() => onOpen(item.appId)}
                className="hover:bg-chip focus-visible:ring-focus rounded-control w-full px-2 py-1 text-left text-[13px] outline-none focus-visible:ring-2"
              >
                <span className="text-ink-muted mr-2">{i + 1}.</span>
                <span className="text-ink">{item.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Widget>
  );
}

export function WorkloadWidget({ rows }: { rows: Workload[] }) {
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <Widget title="Workload by person" icon={UsersIcon} testId="workload-widget">
      {rows.length === 0 ? (
        <Empty>No open to-dos.</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.slice(0, 8).map((r) => (
            <li key={r.owner} className="flex items-center gap-2 text-[12.5px]">
              <span className="text-ink w-28 shrink-0 truncate" title={r.owner}>
                {r.owner}
              </span>
              <span className="bg-chip h-2.5 min-w-0 flex-1 overflow-hidden rounded-full">
                <span
                  className="bg-accent block h-full rounded-full"
                  style={{ width: `${(r.open / max) * 100}%` }}
                />
              </span>
              <span className="text-ink-muted w-24 shrink-0 text-right">
                {r.open} open
                {r.overdue
                  ? `, ${r.overdue} late`
                  : r.dueSoon
                    ? `, ${r.dueSoon} soon`
                    : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

/** A bar for each age band of the open to-dos. */
export function AgingWidget({ buckets }: { buckets: AgeBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <Widget
      title="How long to-dos have sat"
      icon={ChartBarIcon}
      count={total}
      testId="aging-widget"
    >
      {total === 0 ? (
        <Empty>No open to-dos.</Empty>
      ) : (
        <div
          className="flex h-36 items-end gap-2"
          role="img"
          aria-label={`Open to-dos by age: ${buckets.map((b) => `${b.label} ${b.count}`).join(", ")}`}
        >
          {buckets.map((b, i) => (
            <div
              key={b.label}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <span className="text-ink-soft text-[12px] font-semibold">{b.count}</span>
              <span
                className={`w-full rounded-t-[4px] ${i >= AGE_BUCKETS.length - 2 ? "bg-amber" : "bg-accent"}`}
                style={{ height: `${Math.max(3, (b.count / max) * 96)}px` }}
              />
              <span className="text-ink-muted text-center text-[10.5px] leading-tight">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function PipelineWidget({ pipeline }: { pipeline: Pipeline }) {
  const total = pipeline.awaiting + pipeline.conditions + pipeline.changes;
  return (
    <Widget
      title="Sign-off pipeline"
      icon={SealCheckIcon}
      count={total || undefined}
      countTone={pipeline.overdue ? "danger" : "neutral"}
      testId="pipeline-widget"
    >
      {total === 0 ? (
        <Empty>No sign-off is waiting.</Empty>
      ) : (
        <>
          <p className="text-ink text-[13px]">
            {pipeline.awaiting} awaiting · {pipeline.conditions} with conditions ·{" "}
            {pipeline.changes} sent back
            {pipeline.overdue ? ` · ${pipeline.overdue} overdue` : ""}
          </p>
          <ul className="flex flex-col gap-1">
            {pipeline.rows.slice(0, 5).map((r) => (
              <Line key={r.id}>
                {r.title}
                <span className={r.overdue ? "text-red" : "text-ink-muted"}>
                  {" "}
                  · {r.state}
                  {r.approver ? ` (${r.approver})` : ""}
                </span>
              </Line>
            ))}
          </ul>
        </>
      )}
    </Widget>
  );
}

export function HealthWidget({ health }: { health: Health }) {
  return (
    <Widget
      title="Report health"
      icon={HeartbeatIcon}
      count={health.score === null ? undefined : `${health.score}%`}
      countTone={
        health.score === null
          ? "neutral"
          : health.score >= 80
            ? "success"
            : health.score >= 50
              ? "warning"
              : "danger"
      }
      testId="health-widget"
    >
      {health.score === null ? (
        <Empty neutral>No report has run yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {health.tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="text-ink min-w-0 truncate">{t.name}</span>
              <span className={t.failing ? "text-red font-semibold" : "text-ink-muted"}>
                {t.percent === null ? "no runs" : `${t.percent}% of last runs`}
                {t.failing ? " · failing now" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

/** This week against last, written by code from the to-dos, report runs and leave. */
export function WeekWidget({ week }: { week: WeekCompare }) {
  return (
    <Widget title="This week vs last" icon={CalendarCheckIcon} testId="week-widget">
      <ul className="flex flex-col gap-1.5">
        {week.lines.map((l) => (
          <Line key={l}>{l}</Line>
        ))}
      </ul>
    </Widget>
  );
}
