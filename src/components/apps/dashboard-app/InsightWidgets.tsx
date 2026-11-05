"use client";

import { useState } from "react";
import {
  CalendarCheckIcon,
  ChartBarIcon,
  HeartbeatIcon,
  SealCheckIcon,
  SunIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  TODAY_APP_LABEL,
  TODAY_TONE,
  deltaText,
  healthChips,
  polylinePoints,
  sparkPoints,
  toneForPercent,
  workloadBars,
  type RowTone,
  type WeekMetric,
} from "@/lib/dashboard/charts";
import {
  AGE_BUCKETS,
  type AgeBucket,
  type Health,
  type Pipeline,
  type TodayItem,
  type TodaySummary,
  type Workload,
} from "@/lib/dashboard/insights";
import { Chip } from "../pmo-todo-app/parts";
import { Empty, Widget } from "./widgets";

const Line = ({ children }: { children: React.ReactNode }) => (
  <li className="text-ink-soft text-[13px] leading-snug">{children}</li>
);

/** Everything that needs you today in one ordered list, most urgent first; each row has an Open button for the
 *  app behind it. The count in the header is the dock badge's number (same function), and rows beyond the
 *  first few are one click away. */
export function TodayWidget({
  summary,
  needsYou,
  onOpen,
}: {
  summary: TodaySummary;
  needsYou: { total: number; meaning: string | null };
  onOpen: (appId: TodayItem["appId"]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = expanded ? summary.items : summary.items.slice(0, TODAY_VISIBLE);
  const hidden = summary.total - items.length;
  return (
    <Widget
      title="Today"
      icon={SunIcon}
      count={needsYou.total || undefined}
      testId="today-widget"
    >
      {summary.total === 0 ? (
        <Empty>Nothing needs you right now.</Empty>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-[var(--color-line)]">
            {items.map((item, i) => (
              <li
                key={`${item.kind}-${i}`}
                className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    TONE_DOT[TODAY_TONE[item.kind]],
                  )}
                />
                <span className="text-ink min-w-0 flex-1 text-[13px] leading-snug">
                  {item.text}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpen(item.appId)}
                  aria-label={`Open ${TODAY_APP_LABEL[item.appId]}: ${item.text}`}
                >
                  Open
                </Button>
              </li>
            ))}
          </ol>
          {(hidden > 0 || expanded) && summary.total > TODAY_VISIBLE && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show fewer" : `+${hidden} more`}
            </Button>
          )}
        </>
      )}
      {needsYou.meaning && (
        <p className="text-ink-muted mt-2 text-[12px]">Dock badge: {needsYou.meaning}</p>
      )}
    </Widget>
  );
}

const TODAY_VISIBLE = 10;

const TONE_DOT: Record<RowTone, string> = {
  danger: "bg-red",
  warning: "bg-amber",
  info: "bg-info",
  neutral: "bg-ink-faint",
};

/** One stacked bar per person: late in red, due soon in amber, the rest in the accent. */
export function WorkloadWidget({ rows }: { rows: Workload[] }) {
  const bars = workloadBars(rows);
  return (
    <Widget title="Workload by person" icon={UsersIcon} testId="workload-widget">
      {bars.length === 0 ? (
        <Empty>No open to-dos.</Empty>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {bars.map((r) => (
              <li key={r.owner} className="flex items-center gap-2 text-[12.5px]">
                <span
                  className="text-ink w-24 shrink-0 truncate @md:w-28"
                  title={r.owner}
                >
                  {r.owner}
                </span>
                <span
                  role="img"
                  aria-label={`${r.owner}: ${r.label}`}
                  className="bg-chip flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full"
                >
                  <span className="bg-red h-full" style={{ width: `${r.overduePct}%` }} />
                  <span className="bg-amber h-full" style={{ width: `${r.soonPct}%` }} />
                  <span
                    className="bg-accent h-full"
                    style={{ width: `${r.otherPct}%` }}
                  />
                </span>
                <span className="text-ink-muted w-24 shrink-0 text-right">{r.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
            <LegendDot className="bg-red">Late</LegendDot>
            <LegendDot className="bg-amber">Due soon</LegendDot>
            <LegendDot className="bg-accent">Other</LegendDot>
          </p>
        </>
      )}
    </Widget>
  );
}

const LegendDot = ({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden className={cn("h-2 w-2 rounded-full", className)} />
    {children}
  </span>
);

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
  const chips = healthChips(health);
  return (
    <Widget
      title="Report health"
      icon={HeartbeatIcon}
      count={health.score === null ? undefined : `${health.score}%`}
      countTone={toneForPercent(health.score)}
      testId="health-widget"
    >
      {health.score === null ? (
        <Empty neutral>No report has run yet.</Empty>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <li key={c.id}>
                <Chip
                  tone={c.tone}
                  title={
                    c.failing
                      ? `${c.name}: failing now`
                      : c.text === "No runs"
                        ? `${c.name}: no runs yet`
                        : `${c.name}: ${c.text} of its last runs worked`
                  }
                  className="h-7 gap-1.5 px-3 text-[12.5px]"
                >
                  <span className="font-semibold">{c.name}</span>
                  <span>{c.text}</span>
                  {c.failing && <span>· failing</span>}
                </Chip>
              </li>
            ))}
          </ul>
          <p className="text-ink-muted text-[11.5px]">
            Share of each report&apos;s last five runs that finished. Red is failing now
            or under half.
          </p>
        </>
      )}
    </Widget>
  );
}

/** A small two-line chart: last week in grey, this week in the accent colour. */
function Sparkline({ metric }: { metric: WeekMetric }) {
  const width = 96;
  const height = 28;
  const max = Math.max(...metric.thisSeries, ...metric.lastSeries, 1);
  const last = sparkPoints(metric.lastSeries, { width, height, max, slots: 7 });
  const now = sparkPoints(metric.thisSeries, { width, height, max, slots: 7 });
  const tip = now.at(-1);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={polylinePoints(last)}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-ink-faint"
      />
      <polyline
        points={polylinePoints(now)}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-accent"
      />
      {tip && <circle cx={tip.x} cy={tip.y} r={2.5} className="fill-accent" />}
    </svg>
  );
}

/** This week against last: a number, the change and a sparkline per measure. */
export function WeekWidget({ metrics }: { metrics: WeekMetric[] }) {
  return (
    <Widget title="This week vs last" icon={CalendarCheckIcon} testId="week-widget">
      <ul className="flex flex-col divide-y divide-[var(--color-line)]">
        {metrics.map((m) => (
          <li
            key={m.key}
            className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0"
            aria-label={`${m.label}: ${m.thisWeek} this week, ${m.lastWeek} last week`}
          >
            <span className="min-w-0 flex-1">
              <span className="text-ink block truncate text-[13px] font-semibold">
                {m.label}
              </span>
              <span className="text-ink-muted block text-[12px]">
                {deltaText(m.delta)}
              </span>
            </span>
            <span className="text-ink w-8 text-right text-[20px] leading-none font-bold tabular-nums">
              {m.thisWeek}
            </span>
            <Sparkline metric={m} />
          </li>
        ))}
      </ul>
      <p className="text-ink-muted flex flex-wrap gap-x-3 text-[11.5px]">
        <LegendDot className="bg-accent">This week</LegendDot>
        <LegendDot className="bg-ink-faint">Last week</LegendDot>
      </p>
    </Widget>
  );
}
