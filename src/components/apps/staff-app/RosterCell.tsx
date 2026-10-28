"use client";

import { memo } from "react";
import { ArrowsLeftRightIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { CellView } from "@/lib/staff/shifts";
import { TONE_PILL } from "./parts";

export type RosterView = "week" | "month";

export interface RosterCellProps {
  view: RosterView;
  memberId: string | null;
  date: string;
  cell: CellView | null;
  /** Approved leave from the Time off tab, shown when nothing is entered for the day. */
  leave: string | null;
  weekend: boolean;
  /** Something for everyone happens on this day (a holiday, a swap day). */
  marked: boolean;
  /** For screen readers and the tooltip: who and which day. */
  who: string;
  onOpen: (memberId: string, date: string, rect: DOMRect) => void;
}

/** One person's day. Memoised: a roster has thousands of these. */
export const RosterCell = memo(function RosterCell({
  view,
  memberId,
  date,
  cell,
  leave,
  weekend,
  marked,
  who,
  onOpen,
}: RosterCellProps) {
  const compact = view === "month";
  const frame = cn(
    "border-line border-b border-l p-[3px]",
    weekend && "bg-chip",
    marked && !weekend && "bg-amber-soft/40",
  );

  if (!memberId) {
    return <td className={cn(frame, "bg-chip/40")} />;
  }

  if (!cell && leave) {
    return (
      <td className={frame}>
        <button
          type="button"
          title={`${who}: approved ${leave}`}
          aria-label={`${who}, ${date}: approved ${leave}. Change`}
          onClick={(e) => onOpen(memberId, date, e.currentTarget.getBoundingClientRect())}
          className={cn(
            "rounded-control flex w-full items-center justify-center border border-dashed border-current/40 text-center font-semibold",
            TONE_PILL.red,
            "focus-visible:ring-focus outline-none focus-visible:ring-2",
            compact ? "h-7 text-[10.5px]" : "h-[46px] text-[11.5px]",
          )}
        >
          {compact ? "LV" : leave}
        </button>
      </td>
    );
  }

  const title = cell
    ? `${who}, ${date}: ${cell.label}${cell.hours ? `, ${cell.hours}` : ""}${cell.days ? ` (${cell.days})` : ""}${cell.schedule ? ` · ${cell.schedule}` : ""}${cell.swap ? " · swapped" : ""}${cell.note ? ` · ${cell.note}` : ""}`
    : `${who}, ${date}: nothing entered`;

  return (
    <td className={frame}>
      <button
        type="button"
        title={title}
        aria-label={`${title}. Change`}
        onClick={(e) => onOpen(memberId, date, e.currentTarget.getBoundingClientRect())}
        className={cn(
          "group rounded-control transition-ui relative flex w-full flex-col items-center justify-center text-center leading-tight",
          "focus-visible:ring-focus outline-none focus-visible:ring-2",
          compact ? "h-7" : "h-[46px]",
          cell
            ? cn(
                TONE_PILL[cell.tone],
                cell.dashed && "border border-dashed border-current/40",
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
            {(cell.swap || cell.note) && (
              <ArrowsLeftRightIcon
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
