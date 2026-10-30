"use client";

import type { ReactNode } from "react";
import {
  ArrowSquareOutIcon,
  BellRingingIcon,
  ChartLineUpIcon,
  ListChecksIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  dueText,
  type ChaserRow,
  type OpenTodos,
  type ReportStatusRow,
  type StatusTone,
} from "@/lib/dashboard/summary";
import { formatDayMonth, formatRange, dayName } from "@/lib/staff/dates";
import type { WhosOff } from "@/lib/staff/whosOff";
import { PersonName } from "@/components/people/PersonName";
import { Chip, FilterPill, ROW_CARD, type ChipTone } from "../pmo-todo-app/parts";

const STATUS_CHIP: Record<StatusTone, ChipTone> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
};

/** One dashboard card: a title with an optional count, a way to open the app behind it, and its content. */
export function Widget({
  title,
  icon: Glyph,
  count,
  countTone = "neutral",
  openLabel,
  onOpen,
  actions,
  children,
  testId,
}: {
  title: string;
  icon: Icon;
  count?: number | string;
  countTone?: ChipTone;
  openLabel?: string;
  onOpen?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cn(ROW_CARD, "flex min-h-[15rem] flex-col gap-3 p-4")}
    >
      <header className="flex items-center gap-2.5">
        <span className="bg-accent-soft text-accent-ink grid h-8 w-8 shrink-0 place-items-center rounded-full">
          <Glyph size={17} weight="duotone" aria-hidden />
        </span>
        <h2 className="text-ink min-w-0 flex-1 truncate text-[15px] font-bold">
          {title}
        </h2>
        {count !== undefined && <Chip tone={countTone}>{count}</Chip>}
        {actions}
        {onOpen && (
          <Button variant="ghost" size="sm" onClick={onOpen} aria-label={openLabel}>
            <ArrowSquareOutIcon size={14} />
            <span className="hidden @lg:inline">{openLabel ?? "Open"}</span>
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-ink-muted flex flex-1 items-center justify-center px-4 py-6 text-center text-[13px] leading-relaxed">
      {children}
    </p>
  );
}

const List = ({ children }: { children: ReactNode }) => (
  <ul className="flex flex-col divide-y divide-[var(--color-line)]">{children}</ul>
);

function Row({
  title,
  detail,
  aside,
  person,
}: {
  title: string;
  detail: string;
  aside?: ReactNode;
  /** The directory person this row is about: the name opens a profile card. */
  person?: { name: string; employeeId: string | null };
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-[13.5px] font-semibold" title={title}>
          {person ? (
            <PersonName name={person.name} employeeId={person.employeeId} />
          ) : (
            title
          )}
        </p>
        <p className="text-ink-muted truncate text-[12px]" title={detail}>
          {detail}
        </p>
      </div>
      {aside}
    </li>
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// --- open to-dos ------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "amber";
}) {
  return (
    <div className="bg-chip rounded-control flex min-w-0 flex-1 flex-col px-3 py-2">
      <span
        className={cn(
          "text-[20px] leading-none font-bold tabular-nums",
          tone === "red" && value > 0 && "text-red",
          tone === "amber" && value > 0 && "text-amber",
          !(tone && value > 0) && "text-ink",
        )}
      >
        {value}
      </span>
      <span className="text-ink-muted mt-1 truncate text-[11.5px] font-semibold">
        {label}
      </span>
    </div>
  );
}

export function OpenTodosWidget({
  summary,
  today,
  onOpen,
}: {
  summary: OpenTodos;
  today: string;
  onOpen: () => void;
}) {
  return (
    <Widget
      title="Open to-dos"
      icon={ListChecksIcon}
      count={summary.open}
      countTone={summary.overdue > 0 ? "danger" : "neutral"}
      openLabel="Open PMO To-Do"
      onOpen={onOpen}
      testId="widget-open-todos"
    >
      <div className="flex gap-2">
        <Stat label="Overdue" value={summary.overdue} tone="red" />
        <Stat label="Due today" value={summary.dueToday} tone="amber" />
        <Stat label="Tomorrow" value={summary.dueTomorrow} />
        <Stat label="Waiting" value={summary.waiting} />
      </div>
      {summary.urgent.length === 0 ? (
        <Empty>
          {summary.open === 0
            ? "No open to-dos. Messages you approve in PMO To-Do show up here."
            : "Nothing is due today or late. Nice."}
        </Empty>
      ) : (
        <List>
          {summary.urgent.map((row) => (
            <Row
              key={row.id}
              title={row.title}
              detail={`${dueText(row, today)} · ${row.owner}${row.waitingOn ? ` · waiting on ${row.waitingOn}` : ""}`}
              aside={
                row.daysLate > 0 ? (
                  <Chip tone="danger">{row.daysLate}d late</Chip>
                ) : row.priority === "high" ? (
                  <Chip tone="warning">High</Chip>
                ) : null
              }
            />
          ))}
        </List>
      )}
    </Widget>
  );
}

// --- chasers ----------------------------------------------------------------------------

export function ChasersWidget({
  rows,
  onOpen,
}: {
  rows: ChaserRow[];
  onOpen: () => void;
}) {
  return (
    <Widget
      title="Overdue chasers"
      icon={BellRingingIcon}
      count={rows.length}
      countTone={rows.length > 0 ? "warning" : "neutral"}
      openLabel="Open PMO To-Do"
      onOpen={onOpen}
      testId="widget-chasers"
    >
      {rows.length === 0 ? (
        <Empty>
          No one is overdue a nudge. Anything you wait on shows here once it has been
          quiet for its chaser days.
        </Empty>
      ) : (
        <List>
          {rows.slice(0, 6).map((row) => (
            <Row
              key={row.id}
              title={row.title}
              detail={`Waiting on ${row.waitingOn || "someone"} · ${plural(row.quietDays, "working day")} quiet (chase every ${row.everyDays})`}
              aside={
                row.overBy > 0 ? (
                  <Chip tone="warning">+{row.overBy}d</Chip>
                ) : (
                  <Chip tone="neutral">Due</Chip>
                )
              }
            />
          ))}
          {rows.length > 6 && (
            <li className="text-ink-muted py-2 text-[12px]">
              +{rows.length - 6} more in PMO To-Do
            </li>
          )}
        </List>
      )}
    </Widget>
  );
}

// --- reports ----------------------------------------------------------------------------

export function ReportsWidget({
  rows,
  engineUp,
  onOpenTasks,
  onViewLog,
}: {
  rows: ReportStatusRow[] | null;
  engineUp: boolean | null;
  onOpenTasks: () => void;
  /** Open a failed task's details (its last run and log) in Tasks. */
  onViewLog?: (taskId: string) => void;
}) {
  const needs = rows?.filter((r) => r.needsYou).length ?? 0;
  return (
    <Widget
      title="Reports"
      icon={ChartLineUpIcon}
      count={rows ? (needs > 0 ? `${needs} need you` : "All clear") : undefined}
      countTone={needs > 0 ? "warning" : "success"}
      openLabel="Open Tasks"
      onOpen={onOpenTasks}
      testId="widget-reports"
    >
      {rows === null ? (
        <Empty>Checking the reports…</Empty>
      ) : (
        <>
          {engineUp === false && (
            <p className="bg-amber-soft text-ink rounded-control px-3 py-2 text-[12.5px]">
              The Tasks engine is not running, so task reports are not shown. Open Tasks
              to start it.
            </p>
          )}
          {rows.length === 0 ? (
            <Empty>No reports to show yet.</Empty>
          ) : (
            <List>
              {rows.map((row) => (
                <Row
                  key={row.id}
                  title={row.name}
                  detail={row.detail}
                  aside={
                    <>
                      {row.tone === "danger" && onViewLog && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewLog(row.id)}
                          aria-label={`View log for ${row.name}`}
                        >
                          View log
                        </Button>
                      )}
                      <Chip tone={STATUS_CHIP[row.tone]}>{row.status}</Chip>
                    </>
                  }
                />
              ))}
            </List>
          )}
        </>
      )}
    </Widget>
  );
}

// --- who is out -------------------------------------------------------------------------

export type OutPeriod = "this-week" | "next-week";

export function WhosOutWidget({
  result,
  period,
  onPeriod,
  today,
  onOpen,
  status,
}: {
  result: WhosOff;
  period: OutPeriod;
  onPeriod: (period: OutPeriod) => void;
  today: string;
  onOpen: () => void;
  /** Whether the staff data has been read yet (so "nobody is off" is not claimed too early). */
  status: "loading" | "ready" | "offline";
}) {
  const people = new Set(result.entries.map((e) => e.name)).size;
  return (
    <Widget
      title="Who’s out"
      icon={UsersThreeIcon}
      count={status === "ready" ? people : undefined}
      openLabel="Open Staff"
      onOpen={onOpen}
      testId="widget-whos-out"
    >
      <div className="flex gap-1.5" role="group" aria-label="Period">
        <FilterPill active={period === "this-week"} onClick={() => onPeriod("this-week")}>
          This week
        </FilterPill>
        <FilterPill active={period === "next-week"} onClick={() => onPeriod("next-week")}>
          Next week
        </FilterPill>
      </div>
      {status === "loading" ? (
        <Empty>Checking the staff roster…</Empty>
      ) : status === "offline" ? (
        <Empty>Can’t reach the staff data right now.</Empty>
      ) : result.entries.length === 0 && result.holidays.length === 0 ? (
        <Empty>
          Nobody is off{" "}
          {period === "this-week" ? "for the rest of this week" : "next week"}.
        </Empty>
      ) : (
        <List>
          {result.entries.map((entry) => {
            const now = entry.start <= today && today <= entry.end;
            return (
              <Row
                key={entry.key}
                title={entry.name}
                person={{ name: entry.name, employeeId: entry.employeeId }}
                detail={`${entry.label} · ${dayName(entry.start)} ${formatRange(entry.start, entry.end)}${entry.pending ? " · waiting for approval" : ""}`}
                aside={now ? <Chip tone="accent">Out today</Chip> : null}
              />
            );
          })}
          {result.holidays.map((holiday) => (
            <Row
              key={holiday.id}
              title={`Holiday: ${holiday.label}`}
              detail={`${formatDayMonth(holiday.date)}${holiday.locations?.length ? ` · ${holiday.locations.join(", ")}` : " · everyone"}`}
            />
          ))}
        </List>
      )}
    </Widget>
  );
}
