"use client";

import { memo } from "react";
import {
  ArrowsLeftRightIcon,
  CalendarCheckIcon,
  HourglassMediumIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { CellView } from "@/lib/staff/shifts";
import { hueClass } from "./parts";

export type RosterView = "today" | "week" | "month" | "cycle";

export interface RosterCellProps {
  view: Exclude<RosterView, "today">;
  /** The row this day belongs to; null for people who have no team yet (nothing can be entered). */
  rowKey: string | null;
  date: string;
  cell: CellView | null;
  /** What was typed in for the day when approved Time off replaces it. */
  covered: string;
  weekend: boolean;
  /** The name of a holiday this person's location observes (tints the day). */
  holiday: string;
  /** The type of leave (PTO, Sick leave ...) waiting for approval on this day, else "". */
  pending: string;
  /** Today's column is tinted so it can be followed down the grid. */
  today: boolean;
  /** First day of a Sunday-Saturday week in the cycle view. */
  weekStart: boolean;
  /** For screen readers and the tooltip: who and which day. */
  who: string;
  onOpen: (rowKey: string, date: string, rect: DOMRect) => void;
}

const HATCH_LEAVE =
  "[background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,currentColor_20%,transparent)_0_2px,transparent_2px_7px)]";
const HATCH_PENDING =
  "[background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-amber)_45%,transparent)_0_2px,transparent_2px_6px)]";

/** Arrow keys move between the day cells of the grid (the cell menu itself is opened with Enter or Space). */
function moveFocus(button: HTMLButtonElement, key: string): boolean {
  const cell = button.closest("td");
  const row = cell?.parentElement as HTMLTableRowElement | null | undefined;
  const table = button.closest("table");
  if (!cell || !row || !table) return false;
  const col = cell.cellIndex;
  const rows = Array.from(table.rows);
  const target = (from: number, step: number): HTMLElement | null => {
    for (let i = from + step; i >= 0 && i < rows.length; i += step) {
      const found = rows[i].cells[col]?.querySelector<HTMLElement>("[data-roster-cell]");
      if (found) return found;
    }
    return null;
  };
  let next: HTMLElement | null = null;
  if (key === "ArrowUp") next = target(rows.indexOf(row), -1);
  else if (key === "ArrowDown") next = target(rows.indexOf(row), 1);
  else {
    const cells = Array.from(row.cells);
    const step = key === "ArrowLeft" ? -1 : 1;
    for (let i = col + step; i >= 0 && i < cells.length && !next; i += step) {
      next = cells[i].querySelector<HTMLElement>("[data-roster-cell]");
    }
  }
  next?.focus();
  return next !== null;
}

/** One person's day. Memoised: a roster has thousands of these. */
export const RosterCell = memo(function RosterCell({
  view,
  rowKey,
  date,
  cell,
  covered,
  weekend,
  holiday,
  pending,
  today,
  weekStart,
  who,
  onOpen,
}: RosterCellProps) {
  const compact = view !== "week";
  const frame = cn(
    "border-line border-b border-l p-[3px]",
    weekStart && "border-l-line-strong",
    weekend && "bg-chip",
    holiday && "bg-[color-mix(in_srgb,var(--rh-hol-bg)_40%,transparent)]",
    today && "bg-accent-soft/60",
  );

  if (!rowKey) {
    return <td className={cn(frame, "bg-chip/40")} />;
  }

  // Waiting leave only marks working days: a weekend with nothing entered stays quiet.
  const showPending = pending !== "" && (!weekend || cell !== null);
  const origin =
    cell?.source === "leave"
      ? " · from Time off"
      : cell?.source === "holiday"
        ? " · holiday"
        : "";
  const title =
    (cell
      ? `${who}, ${date}: ${cell.label}${cell.hours ? `, ${cell.hours}` : ""}${cell.days ? ` (${cell.days})` : ""}${cell.schedule ? ` · ${cell.schedule}` : ""}${cell.swap ? " · swapped" : ""}${cell.note ? ` · ${cell.note}` : ""}${origin}${covered ? ` · planned: ${covered}` : ""}${holiday && cell.source !== "holiday" ? ` · holiday: ${holiday}` : ""}`
      : `${who}, ${date}: nothing entered`) +
    (showPending ? ` · ${pending} waiting for approval` : "");

  return (
    <td className={frame}>
      <button
        type="button"
        data-roster-cell
        title={title}
        aria-label={`${title}. Change`}
        onClick={(e) => onOpen(rowKey, date, e.currentTarget.getBoundingClientRect())}
        onKeyDown={(e) => {
          if (!e.key.startsWith("Arrow") || e.altKey || e.ctrlKey || e.metaKey) return;
          if (moveFocus(e.currentTarget, e.key)) e.preventDefault();
        }}
        className={cn(
          "group rounded-control transition-ui relative flex w-full flex-col items-center justify-center text-center leading-tight",
          "focus-visible:ring-focus outline-none focus-visible:ring-2",
          compact ? "h-7" : "h-[46px]",
          cell
            ? cn(
                hueClass(cell.hue),
                cell.dashed && "border border-dashed border-current/40",
                cell.source === "leave" && HATCH_LEAVE,
                "hover:brightness-95",
              )
            : "text-ink-faint hover:bg-chip-strong hover:text-ink-soft",
        )}
      >
        {showPending && (
          <span
            aria-hidden
            className={cn(
              "text-amber rounded-control pointer-events-none absolute inset-0 border border-dashed border-current",
              HATCH_PENDING,
            )}
          >
            {!compact && (
              <HourglassMediumIcon
                size={10}
                weight="bold"
                className="absolute bottom-[3px] left-[3px]"
              />
            )}
          </span>
        )}
        {cell ? (
          <>
            <span
              className={cn(
                "font-bold",
                compact ? "text-[10.5px]" : "text-[12px]",
                cell.kind === "custom" && !compact && "text-[11px]",
              )}
            >
              {cell.short}
            </span>
            {!compact && cell.hours && cell.kind !== "custom" && (
              <span className="max-w-full truncate px-1 text-[10px] font-medium opacity-80">
                {cell.hours.replace(/ (AM|PM)/g, (m) => m.trim().toLowerCase()[0])}
              </span>
            )}
            {!compact && cell.kind === "custom" && (
              <span className="max-w-full truncate px-1 text-[10px] font-medium opacity-80">
                {cell.hours}
              </span>
            )}
            {!compact && cell.source === "holiday" && (
              <span className="max-w-full truncate px-1 text-[10px] font-medium opacity-80">
                {cell.label}
              </span>
            )}
            {!compact && cell.source === "leave" && (
              <span className="max-w-full truncate px-1 text-[10px] font-medium opacity-80">
                Time off
              </span>
            )}
            {(cell.swap || cell.note) && (
              <ArrowsLeftRightIcon
                size={compact ? 8 : 10}
                weight="bold"
                aria-hidden
                className="absolute top-[3px] right-[3px] opacity-70"
              />
            )}
            {cell.source === "leave" && (
              <CalendarCheckIcon
                size={compact ? 8 : 10}
                weight="bold"
                aria-hidden
                className="absolute top-[3px] right-[3px] opacity-70"
              />
            )}
          </>
        ) : (
          <PlusIcon
            size={12}
            weight="bold"
            className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </button>
    </td>
  );
});
