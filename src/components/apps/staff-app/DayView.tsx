"use client";

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { CalendarCheckIcon, EyeSlashIcon, PlusIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { addDays, isWeekend } from "@/lib/staff/dates";
import { describeLocations, holidayAt } from "@/lib/staff/holidays";
import {
  assignmentId,
  dayCell,
  daySpan,
  leaveOn,
  minutesNow,
  spanActiveAt,
  toMinutes,
  usuallyWorks,
  type CellView,
  type DaySpan,
  type RosterRow,
  type RosterSection,
} from "@/lib/staff/shifts";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import type { RosterEvent, ShiftAssignment, TimeOffRequest } from "@/lib/staff/types";
import { PersonAvatar, hueClass } from "./parts";
import { teamHue } from "./RosterParts";

const NAME_COL = 240;
const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

const hourLabel = (h: number): string =>
  h === 0 || h === 24
    ? "12 AM"
    : h === 12
      ? "12 PM"
      : h < 12
        ? `${h} AM`
        : `${h - 12} PM`;

/** Vertical hour lines behind a track. */
const GRID_LINES = {
  backgroundImage:
    "repeating-linear-gradient(to right, var(--color-line) 0, var(--color-line) 1px, transparent 1px, transparent calc(100% / 24))",
} as const;

interface DayRow {
  row: RosterRow;
  rowKey: string | null;
  cell: CellView | null;
  covered: string;
  span: DaySpan | null;
  /** Last night's overnight shift, still running early today. */
  tail: { cell: CellView; span: DaySpan } | null;
}

export interface DayViewProps {
  date: string;
  today: string;
  sections: readonly RosterSection[];
  index: ReadonlyMap<string, ShiftAssignment>;
  viewOf: (a: ShiftAssignment) => CellView;
  timeOff: readonly TimeOffRequest[];
  eventsByDay: ReadonlyMap<string, RosterEvent[]>;
  choices: readonly string[];
  onOpen: (rowKey: string, date: string, rect: DOMRect) => void;
  onHide: (section: RosterSection) => void;
}

/** The current minute of the day, refreshed while it is shown. */
function useNowMinutes(active: boolean): number {
  const [now, setNow] = useState(() => minutesNow());
  useEffect(() => {
    if (!active) return;
    setNow(minutesNow());
    const timer = setInterval(() => setNow(minutesNow()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Track({
  children,
  now,
}: {
  children: ReactNode;
  /** Minutes after midnight for the "now" line; null when not shown. */
  now: number | null;
}) {
  return (
    <div className="relative h-11" style={GRID_LINES}>
      {children}
      {now !== null && (
        <span
          aria-hidden
          className="bg-accent pointer-events-none absolute top-0 bottom-0 z-[1] w-0.5"
          style={{ left: `${(now / 1440) * 100}%` }}
        />
      )}
    </div>
  );
}

function pillStyle(span: DaySpan) {
  return {
    left: `${(span.from / 1440) * 100}%`,
    width: `${((span.to - span.from) / 1440) * 100}%`,
  };
}

export function DayView({
  date,
  today,
  sections,
  index,
  viewOf,
  timeOff,
  eventsByDay,
  choices,
  onOpen,
  onHide,
}: DayViewProps) {
  const isToday = date === today;
  const nowMinute = useNowMinutes(isToday);
  const approved = useMemo(
    () => timeOff.filter((r) => r.status === "approved"),
    [timeOff],
  );
  const yesterday = addDays(date, -1);
  const events = eventsByDay.get(date);
  const weekend = isWeekend(date);

  const data = useMemo(() => {
    return sections.map((section) => {
      const rows: DayRow[] = section.rows.map((row) => {
        const entry = row.member
          ? index.get(assignmentId(row.member.id, date))
          : undefined;
        const leave = row.employee ? leaveOn(approved, row.employee.id, date) : undefined;
        const holiday = holidayAt(events, row.location);
        const works =
          leave || holiday
            ? ((row.member ? usuallyWorks(index, row.member.id, date) : null) ?? !weekend)
            : false;
        const { cell, covered } = dayCell(
          entry ? viewOf(entry) : null,
          leave ? { type: leave.type, label: TIME_OFF_META[leave.type].label } : null,
          holiday?.label ?? null,
          works,
        );
        const span =
          cell && cell.working && cell.range ? daySpan(cell.range, "today") : null;
        const before = row.member
          ? index.get(assignmentId(row.member.id, yesterday))
          : undefined;
        const beforeCell = before ? viewOf(before) : null;
        const tailSpan =
          beforeCell && beforeCell.working && beforeCell.range
            ? daySpan(beforeCell.range, "yesterday")
            : null;
        return {
          row,
          rowKey: section.group ? row.key : null,
          cell,
          covered,
          span,
          tail: beforeCell && tailSpan ? { cell: beforeCell, span: tailSpan } : null,
        };
      });
      rows.sort((a, b) => {
        const rank = (r: DayRow) => (r.span ? 0 : r.cell ? 1 : 2);
        return (
          rank(a) - rank(b) ||
          (a.span?.from ?? 0) - (b.span?.from ?? 0) ||
          a.row.name.localeCompare(b.row.name)
        );
      });
      return { section, rows };
    });
  }, [sections, index, viewOf, approved, date, yesterday, events, weekend]);

  const totals = useMemo(() => {
    let working = 0;
    let onNow = 0;
    let away = 0;
    let empty = 0;
    for (const { rows } of data) {
      for (const r of rows) {
        if (r.span) working++;
        else if (r.cell) away++;
        else empty++;
        const live =
          (r.span && spanActiveAt(r.span, nowMinute)) ||
          (r.tail && spanActiveAt(r.tail.span, nowMinute));
        if (live) onNow++;
      }
    }
    return { working, onNow, away, empty };
  }, [data, nowMinute]);

  if (data.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {isToday && (
          <span className="rh-s1 rounded-chip px-3 py-1 font-bold">
            {totals.onNow} on shift now
          </span>
        )}
        <span className="bg-chip text-ink-soft rounded-chip px-3 py-1 font-semibold">
          {totals.working} working this day
        </span>
        <span className="bg-chip text-ink-soft rounded-chip px-3 py-1 font-semibold">
          {totals.away} off or on leave
        </span>
        {totals.empty > 0 && (
          <span className="text-ink-muted px-1">{totals.empty} with nothing entered</span>
        )}
        {events?.map((e) => (
          <span
            key={e.id}
            className={cn(
              "rounded-chip px-3 py-1 font-semibold",
              hueClass(e.kind === "holiday" ? "hol" : e.kind === "swap" ? "swap" : "off"),
            )}
          >
            {e.label}
            {e.kind === "holiday" && ` · ${describeLocations(e.locations, choices)}`}
          </span>
        ))}
      </div>

      <div className="border-line rounded-card bg-card overflow-hidden border">
        <div
          className="border-line bg-surface-elevated sticky top-0 z-[3] grid border-b"
          style={{ gridTemplateColumns: `${NAME_COL}px minmax(560px, 1fr)` }}
        >
          <div className="text-ink-muted px-4 py-2 text-[11.5px] font-bold tracking-[0.06em] uppercase">
            Employee
          </div>
          <div className="relative mr-3 h-8">
            {AXIS_HOURS.map((h) => (
              <span
                key={h}
                className={cn(
                  "text-ink-muted absolute top-2 text-[10.5px] font-semibold whitespace-nowrap",
                  h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>
        </div>

        {data.map(({ section, rows }, i) => (
          <section key={section.id} aria-label={section.group?.name ?? "No team"}>
            <div
              className={cn(
                "border-line-strong bg-chip relative flex items-center gap-3 border-y py-2.5 pr-3 pl-5",
                i > 0 && "mt-3",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 bottom-0 left-0 w-1.5",
                  hueClass(section.group ? teamHue(section.id) : "off"),
                )}
              />
              <h3 className="text-ink text-[14px] font-bold">
                {section.group?.name ?? "Not in a team yet"}
              </h3>
              <span className="text-ink-muted text-[12px]">
                {rows.filter((r) => r.span).length} of {rows.length} working
              </span>
              {section.group && (
                <IconButton
                  aria-label={`Hide ${section.group.name}`}
                  title="Hide this team"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onHide(section)}
                >
                  <EyeSlashIcon />
                </IconButton>
              )}
            </div>
            {rows.map((r) => (
              <div
                key={r.row.key}
                className="border-line grid items-center border-b last:border-b-0"
                style={{ gridTemplateColumns: `${NAME_COL}px minmax(560px, 1fr)` }}
              >
                <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                  <PersonAvatar employee={r.row.employee} name={r.row.name} size="sm" />
                  <div className="min-w-0">
                    <p
                      className="text-ink truncate text-[13px] font-semibold"
                      title={r.row.name}
                    >
                      {r.row.name}
                    </p>
                    <p className="text-ink-muted truncate text-[11.5px]">
                      {r.row.subtitle || "\u00a0"}
                    </p>
                  </div>
                </div>
                <div className="mr-3">
                  <Track now={isToday ? nowMinute : null}>
                    {r.tail && (
                      <span
                        title={`${r.row.name}: ${r.tail.cell.label} ${r.tail.cell.hours} (started the evening before)`}
                        className={cn(
                          "rounded-r-chip absolute top-1.5 bottom-1.5 flex items-center overflow-hidden px-2 text-[10.5px] font-semibold whitespace-nowrap opacity-55",
                          hueClass(r.tail.cell.hue),
                        )}
                        style={pillStyle(r.tail.span)}
                      >
                        ← from yesterday
                      </span>
                    )}
                    <CellPill r={r} date={date} onOpen={onOpen} />
                  </Track>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** What the person does on the day, as a stretch of the track or a full-width note. */
function CellPill({
  r,
  date,
  onOpen,
}: {
  r: DayRow;
  date: string;
  onOpen: (rowKey: string, date: string, rect: DOMRect) => void;
}) {
  const { cell, span, rowKey } = r;
  const open = (e: MouseEvent<HTMLButtonElement>) =>
    rowKey && onOpen(rowKey, date, e.currentTarget.getBoundingClientRect());
  const focus = "focus-visible:ring-focus outline-none focus-visible:ring-2";

  if (!cell) {
    return (
      <button
        type="button"
        disabled={!rowKey}
        onClick={open}
        aria-label={`${r.row.name}: nothing entered. Change`}
        className={cn(
          "text-ink-faint hover:text-ink-soft hover:bg-chip/60 absolute inset-1 flex items-center gap-1.5 rounded-md px-2 text-[11.5px] disabled:pointer-events-none",
          focus,
        )}
      >
        <PlusIcon size={12} weight="bold" />
        Nothing entered
      </button>
    );
  }

  const title = `${r.row.name}: ${cell.label}${cell.hours ? `, ${cell.hours}` : ""}${cell.schedule ? ` · ${cell.schedule}` : ""}${cell.swap ? " · swapped" : ""}${cell.note ? ` · ${cell.note}` : ""}${r.covered ? ` · planned: ${r.covered}` : ""}`;

  if (!span) {
    return (
      <button
        type="button"
        title={title}
        aria-label={`${title}. Change`}
        disabled={!rowKey}
        onClick={open}
        className={cn(
          "absolute inset-y-1.5 right-0 left-0 flex items-center gap-1.5 rounded-md border border-dashed border-current/40 px-3 text-[12px] font-semibold",
          hueClass(cell.hue),
          focus,
        )}
      >
        {cell.source === "leave" && <CalendarCheckIcon size={13} weight="bold" />}
        <span className="font-bold">{cell.short}</span>
        <span className="truncate font-medium opacity-85">{cell.label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      aria-label={`${title}. Change`}
      disabled={!rowKey}
      onClick={open}
      className={cn(
        "absolute top-1.5 bottom-1.5 z-[0] flex items-center gap-2 overflow-hidden px-2.5 text-left text-[12px] whitespace-nowrap shadow-sm",
        span.open ? "rounded-l-md" : "rounded-md",
        hueClass(cell.hue),
        focus,
      )}
      style={pillStyle(span)}
    >
      <span className="font-bold">{cell.short}</span>
      <span className="truncate font-medium opacity-90">
        {cell.range
          ? `${formatShort(cell.range.start)} – ${formatShort(cell.range.end)}`
          : cell.hours}
        {span.open && " →"}
      </span>
    </button>
  );
}

function formatShort(hhmm: string): string {
  const total = toMinutes(hhmm);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
