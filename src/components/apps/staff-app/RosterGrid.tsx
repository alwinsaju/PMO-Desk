"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import {
  dayName,
  formatDayMonth,
  formatRange,
  isWeekend,
  weekdayIndex,
} from "@/lib/staff/dates";
import { describeLocations, holidayAt } from "@/lib/staff/holidays";
import {
  assignmentId,
  coverageOn,
  dayCell,
  leaveOn,
  usuallyWorks,
  type CellView,
  type RosterRow,
  type RosterSection,
} from "@/lib/staff/shifts";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import type {
  RosterConfig,
  RosterEvent,
  ShiftAssignment,
  TimeOffRequest,
} from "@/lib/staff/types";
import { hueClass } from "./parts";
import { PersonCell, SectionHeader } from "./RosterParts";
import { RosterCell, type RosterView } from "./RosterCell";

const NAME_COL = 240;
const DAY_COL: Record<Exclude<RosterView, "today">, number> = {
  week: 112,
  month: 40,
  cycle: 34,
};
const EVENT_ROW = { week: 48, month: 22, cycle: 22 } as const;
const WEEK_ROW = 24;

const EVENT_HUE = { holiday: "hol", swap: "swap", note: "off" } as const;

export interface GridActions {
  open: (rowKey: string, date: string, rect: DOMRect) => void;
  link: (row: RosterRow) => void;
  unlink: (row: RosterRow) => void;
  move: (row: RosterRow, groupId: string) => void;
  setLocation: (row: RosterRow, location: string) => void;
  remove: (row: RosterRow) => void;
  hide: (section: RosterSection) => void;
}

export interface RosterGridProps {
  view: Exclude<RosterView, "today">;
  days: readonly string[];
  today: string;
  sections: readonly RosterSection[];
  config: RosterConfig;
  index: ReadonlyMap<string, ShiftAssignment>;
  viewOf: (a: ShiftAssignment) => CellView;
  timeOff: readonly TimeOffRequest[];
  eventsByDay: ReadonlyMap<string, RosterEvent[]>;
  /** Every location a holiday can apply to. */
  choices: readonly string[];
  actions: GridActions;
}

/** The holiday / swap / note of a day, above its date: loud in the week view
 *  (name and where it applies), a coloured bar in the denser views. */
function EventStrip({
  events,
  view,
  choices,
}: {
  events: readonly RosterEvent[];
  view: RosterGridProps["view"];
  choices: readonly string[];
}) {
  const title = events
    .map((e) =>
      e.kind === "holiday"
        ? `${e.label} (${describeLocations(e.locations, choices)})`
        : e.label,
    )
    .join(" · ");
  const first = events[0];
  const hue = events.some((e) => e.kind === "holiday") ? "hol" : EVENT_HUE[first.kind];
  if (view !== "week") {
    return (
      <div
        title={title}
        aria-label={title}
        className={cn("mx-px h-[14px] rounded-[3px]", hueClass(hue))}
      />
    );
  }
  return (
    <div
      title={title}
      className={cn(
        "mx-[3px] flex h-[40px] flex-col justify-center overflow-hidden rounded-md px-1.5 text-left leading-tight",
        hueClass(EVENT_HUE[first.kind]),
        first.kind === "holiday" && "border border-current/30",
      )}
    >
      <span className="truncate text-[11px] font-bold">{first.label}</span>
      <span className="truncate text-[10px] font-medium opacity-85">
        {first.kind === "holiday"
          ? describeLocations(first.locations, choices)
          : first.kind === "swap"
            ? "Shift swap"
            : "Note"}
        {events.length > 1 && ` · +${events.length - 1}`}
      </span>
    </div>
  );
}

export function RosterGrid({
  view,
  days,
  today,
  sections,
  config,
  index,
  viewOf,
  timeOff,
  eventsByDay,
  choices,
  actions,
}: RosterGridProps) {
  const cycle = view === "cycle";
  const hasEvents = days.some((d) => eventsByDay.has(d));
  const eventRow = hasEvents ? EVENT_ROW[view] : 6;
  const dayCol = DAY_COL[view];
  const approved = useMemo(
    () => timeOff.filter((r) => r.status === "approved"),
    [timeOff],
  );
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const weeks = useMemo(() => {
    if (!cycle) return [];
    const list: { start: string; end: string }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      list.push({ start: days[i], end: days[Math.min(i + 6, days.length - 1)] });
    }
    return list;
  }, [cycle, days]);
  const dayRowTop = eventRow + (cycle ? WEEK_ROW : 0);

  return (
    <table
      className="border-separate border-spacing-0"
      style={{
        tableLayout: "fixed",
        width: view === "week" ? "100%" : NAME_COL + days.length * dayCol,
        minWidth: NAME_COL + days.length * dayCol,
      }}
    >
      <colgroup>
        <col style={{ width: NAME_COL }} />
        {days.map((day) => (
          <col key={day} style={{ width: dayCol }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th
            scope="col"
            rowSpan={cycle ? 3 : 2}
            className="border-line text-ink-muted bg-surface-elevated sticky top-0 left-0 z-[4] border-b border-l px-4 text-left align-bottom text-[11.5px] font-bold tracking-[0.06em] uppercase"
          >
            Employee
          </th>
          {days.map((day) => {
            const events = eventsByDay.get(day);
            return (
              <th
                key={day}
                scope="col"
                style={{ height: eventRow }}
                className="bg-surface-elevated sticky top-0 z-[3] border-l border-transparent p-0 align-bottom"
              >
                {events && <EventStrip events={events} view={view} choices={choices} />}
              </th>
            );
          })}
        </tr>
        {cycle && (
          <tr>
            {weeks.map((week) => (
              <th
                key={week.start}
                scope="colgroup"
                colSpan={7}
                style={{ top: eventRow, height: WEEK_ROW }}
                className="border-line-strong bg-surface-elevated text-ink-muted sticky z-[3] border-l px-2 text-left text-[10.5px] font-semibold"
              >
                {formatRange(week.start, week.end)}
              </th>
            ))}
          </tr>
        )}
        <tr>
          {days.map((day) => {
            const isToday = day === today;
            const holiday = eventsByDay.get(day)?.some((e) => e.kind === "holiday");
            return (
              <th
                key={day}
                scope="col"
                style={{ top: dayRowTop }}
                className={cn(
                  "border-line bg-surface-elevated sticky z-[3] border-b border-l text-center",
                  view === "week" ? "px-1 py-1.5" : "px-0 py-1",
                  cycle && weekdayIndex(day) === 6 && "border-l-line-strong",
                  isWeekend(day) &&
                    "[background-image:linear-gradient(var(--color-chip),var(--color-chip))]",
                )}
              >
                <span className="text-ink-muted block text-[10.5px] font-bold tracking-[0.06em] uppercase">
                  {view === "week" ? dayName(day) : dayName(day).slice(0, 1)}
                </span>
                <span
                  className={cn(
                    "mt-0.5 inline-block rounded-full px-1.5 text-[12px] font-semibold",
                    isToday
                      ? "bg-accent text-accent-contrast"
                      : holiday
                        ? "rh-hol"
                        : "text-ink",
                  )}
                >
                  {view === "week" ? formatDayMonth(day) : day.slice(8).replace(/^0/, "")}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      {sections.map((section, sectionIndex) => (
        <tbody key={section.id}>
          {sectionIndex > 0 && (
            <tr aria-hidden>
              <td colSpan={days.length + 1} className="h-5 p-0" />
            </tr>
          )}
          <tr>
            <td
              colSpan={days.length + 1}
              className="border-line-strong bg-card relative border-y border-l p-0"
            >
              <SectionHeader section={section} onHide={() => actions.hide(section)} />
            </td>
          </tr>
          {section.rows.map((row) => {
            const rowKey = section.group ? row.key : null;
            return (
              <tr key={row.key} className="[&>td:last-child]:border-r">
                <th
                  scope="row"
                  className="border-line bg-surface-elevated sticky left-0 z-[2] border-b border-l px-3 py-1.5 text-left font-normal"
                >
                  <PersonCell
                    row={row}
                    section={section}
                    groups={config.groups}
                    locations={choices}
                    onLink={() => actions.link(row)}
                    onUnlink={() => actions.unlink(row)}
                    onMove={(gid) => actions.move(row, gid)}
                    onLocation={(l) => actions.setLocation(row, l)}
                    onRemove={() => actions.remove(row)}
                  />
                </th>
                {days.map((day) => {
                  const entry = row.member
                    ? index.get(assignmentId(row.member.id, day))
                    : undefined;
                  const leave = row.employee
                    ? leaveOn(approved, row.employee.id, day)
                    : undefined;
                  const holiday = holidayAt(eventsByDay.get(day), row.location);
                  const weekend = isWeekend(day);
                  const works =
                    leave || holiday
                      ? ((row.member ? usuallyWorks(index, row.member.id, day) : null) ??
                        !weekend)
                      : false;
                  const { cell, covered } = dayCell(
                    entry ? viewOf(entry) : null,
                    leave
                      ? { type: leave.type, label: TIME_OFF_META[leave.type].label }
                      : null,
                    holiday?.label ?? null,
                    works,
                  );
                  return (
                    <RosterCell
                      key={day}
                      view={view}
                      rowKey={rowKey}
                      date={day}
                      cell={cell}
                      covered={covered}
                      weekend={weekend}
                      holiday={holiday?.label ?? ""}
                      weekStart={cycle && weekdayIndex(day) === 6}
                      who={row.name}
                      onOpen={actions.open}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      ))}
      <tfoot>
        <tr>
          <td colSpan={days.length + 1} className="h-5 p-0" />
        </tr>
        <tr className="[&>td:last-child]:border-r">
          <th
            scope="row"
            className="text-ink-muted bg-chip border-line sticky left-0 z-[2] border-y border-l px-4 py-2.5 text-left text-[12px] font-bold tracking-[0.06em] uppercase"
          >
            On shift
          </th>
          {days.map((day) => (
            <td
              key={day}
              className="bg-chip text-ink border-line border-y border-l px-1 py-2.5 text-center text-[12.5px] font-bold"
            >
              {coverageOn(day, rows, index, config.schedules, approved)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}
