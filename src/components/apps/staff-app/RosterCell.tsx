"use client";

import { memo } from "react";
import { ArrowsLeftRightIcon, CalendarCheckIcon, PlusIcon } from "@phosphor-icons/react";
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
  /** First day of a Sunday-Saturday week in the cycle view. */
  weekStart: boolean;
  /** For screen readers and the tooltip: who and which day. */
  who: string;
  onOpen: (rowKey: string, date: string, rect: DOMRect) => void;
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
  );

  if (!rowKey) {
    return <td className={cn(frame, "bg-chip/40")} />;
  }

  const origin =
    cell?.source === "leave"
      ? " · from Time off"
      : cell?.source === "holiday"
        ? " · holiday"
        : "";
  const title = cell
    ? `${who}, ${date}: ${cell.label}${cell.hours ? `, ${cell.hours}` : ""}${cell.days ? ` (${cell.days})` : ""}${cell.schedule ? ` · ${cell.schedule}` : ""}${cell.swap ? " · swapped" : ""}${cell.note ? ` · ${cell.note}` : ""}${origin}${covered ? ` · planned: ${covered}` : ""}${holiday && cell.source !== "holiday" ? ` · holiday: ${holiday}` : ""}`
    : `${who}, ${date}: nothing entered`;

  return (
    <td className={frame}>
      <button
        type="button"
        title={title}
        aria-label={`${title}. Change`}
        onClick={(e) => onOpen(rowKey, date, e.currentTarget.getBoundingClientRect())}
        className={cn(
          "group rounded-control transition-ui relative flex w-full flex-col items-center justify-center text-center leading-tight",
          "focus-visible:ring-focus outline-none focus-visible:ring-2",
          compact ? "h-7" : "h-[46px]",
          cell
            ? cn(
                hueClass(cell.hue),
                cell.dashed && "border border-dashed border-current/40",
                "hover:brightness-95",
              )
            : "text-ink-faint hover:bg-chip-strong hover:text-ink-soft",
        )}
      >
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
