"use client";

import {
  CaretRightIcon,
  DotsThreeIcon,
  EyeSlashIcon,
  LinkBreakIcon,
  MapPinIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/staff/dates";
import { CUSTOM_REF, STATUS_DEFS, statusRef, type Hue } from "@/lib/staff/rosterCatalog";
import {
  compactHours,
  formatDays,
  formatHours,
  hueOfShift,
  shiftRef,
  shortLabel,
  type RosterRow,
  type RosterSection,
} from "@/lib/staff/shifts";
import type { RosterGroup, ShiftAssignment, ShiftSchedule } from "@/lib/staff/types";
import { PersonAvatar, hueClass, hueDot } from "./parts";

export interface MenuTarget {
  rowKey: string;
  date: string;
  rect: DOMRect;
}

const TEAM_HUES: readonly Hue[] = ["s3", "s1", "s4", "cst", "s5", "ns", "wk", "pst"];

/** A team keeps its colour: picked from its id, not from where it sits in the list. */
export function teamHue(id: string): Hue {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_HUES[sum % TEAM_HUES.length];
}

/** The team's name and, when `showShifts` is on, its legend: each shift with its hours.
 *  The same name can mean different hours in another team, so every section shows its own. */
export function SectionHeader({
  section,
  showShifts,
  onHide,
}: {
  section: RosterSection;
  showShifts: boolean;
  onHide: () => void;
}) {
  const { group, schedule, rows } = section;
  return (
    <div
      className={cn(
        "sticky left-0 flex w-[min(100%,1100px)] items-start gap-3 pr-4 pl-5",
        showShifts ? "py-3" : "py-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0 bottom-0 left-0 w-1.5",
          hueDot(group ? teamHue(section.id) : "off"),
        )}
      />
      <div
        className={cn("flex min-w-0 flex-1 flex-col", showShifts ? "gap-2.5" : "gap-1")}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-ink flex items-center gap-2 text-[15px] font-bold">
            {group ? group.name : "Not in a team yet"}
            <span className="bg-chip text-ink-soft rounded-chip px-2 py-0.5 text-[11.5px] font-semibold">
              {rows.length}
            </span>
            {group && (
              <IconButton
                aria-label={`Hide ${group.name}`}
                title="Hide this team"
                size="sm"
                onClick={onHide}
              >
                <EyeSlashIcon />
              </IconButton>
            )}
          </h3>
          {group && schedule && (
            <span className="text-ink-muted text-[12px]">{schedule.name} schedule</span>
          )}
        </div>
        {showShifts && group && schedule && (
          <ul
            aria-label={`${schedule.name} shifts`}
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))" }}
          >
            {schedule.shifts.map((s) => (
              <li
                key={s.id}
                className="border-line bg-surface-elevated flex items-stretch overflow-hidden rounded-lg border"
              >
                <span
                  className={cn(
                    "grid w-10 shrink-0 place-items-center text-[11.5px] font-bold",
                    hueClass(hueOfShift(s)),
                  )}
                >
                  {shortLabel(s.label)}
                </span>
                <span className="min-w-0 px-2.5 py-1.5 leading-tight">
                  <span className="text-ink block truncate text-[12.5px] font-semibold">
                    {compactHours(s.start, s.end)}
                  </span>
                  <span className="text-ink-muted block truncate text-[11px]">
                    {s.label}
                    {s.days.length > 0 && ` · ${formatDays(s.days)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!group && (
          <span className="text-ink-muted text-[12px]">
            Their directory profile names no team. Set the Team there, or choose one from
            the row menu.
          </span>
        )}
      </div>
    </div>
  );
}

export function PersonCell({
  row,
  section,
  groups,
  locations,
  onLink,
  onUnlink,
  onMove,
  onLocation,
  onRemove,
}: {
  row: RosterRow;
  section: RosterSection;
  groups: readonly RosterGroup[];
  locations: readonly string[];
  onLink: () => void;
  onUnlink: () => void;
  onMove: (groupId: string) => void;
  onLocation: (location: string) => void;
  onRemove: () => void;
}) {
  const unlinked = row.member !== null && row.employee === null;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar employee={row.employee} name={row.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-[13px] font-semibold" title={row.name}>
          {row.name}
        </p>
        <p className="text-ink-muted truncate text-[11.5px]" title={row.subtitle}>
          {row.subtitle || "\u00a0"}
        </p>
      </div>
      {unlinked && (
        <LinkBreakIcon
          size={14}
          aria-label="Not in the directory"
          role="img"
          className="text-ink-faint shrink-0"
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={`Options for ${row.name}`}
            size="sm"
            className="shrink-0"
          >
            <DotsThreeIcon weight="bold" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {unlinked && (
            <DropdownMenuItem onSelect={onLink}>
              Link to a directory profile…
            </DropdownMenuItem>
          )}
          {row.member && row.employee && (
            <DropdownMenuItem onSelect={onUnlink}>
              Unlink from the directory
            </DropdownMenuItem>
          )}
          {section.group && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MapPinIcon size={14} />
                Location: {row.location || "not set"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                <DropdownMenuRadioGroup value={row.location} onValueChange={onLocation}>
                  {locations.map((l) => (
                    <DropdownMenuRadioItem key={l} value={l}>
                      {l}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {(row.employee === null || section.group === null) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {row.member ? "Move to team" : "Add to team"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {groups.map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    disabled={g.id === section.id}
                    onSelect={() => onMove(g.id)}
                  >
                    {g.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {row.member && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red" onSelect={onRemove}>
                Remove from the shift roster
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** One menu for the whole grid, opened over the cell that was clicked. */
export function CellMenu({
  menu,
  schedule,
  name,
  current,
  leaveNote,
  onClose,
  onSet,
  onFill,
  onSwap,
  onCustom,
  onClear,
}: {
  menu: MenuTarget | null;
  schedule: ShiftSchedule | undefined;
  name: string;
  current: ShiftAssignment | null;
  /** "Approved PTO covers this day", when Time off replaces what is entered. */
  leaveNote: string | null;
  onClose: () => void;
  onSet: (ref: string) => void;
  onFill: (def: ShiftSchedule["shifts"][number]) => void;
  onSwap: (swap: boolean) => void;
  onCustom: () => void;
  onClear: () => void;
}) {
  const rect = menu?.rect;
  return (
    <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: rect?.left ?? 0,
            top: rect?.top ?? 0,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        collisionPadding={8}
        className="max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] min-w-[250px] overflow-y-auto"
      >
        {menu && (
          <>
            <DropdownMenuLabel>
              {name} · {formatDate(menu.date)}
            </DropdownMenuLabel>
            {leaveNote && (
              <p className="text-ink-muted max-w-[270px] px-3 pb-1.5 text-[12px] leading-snug">
                {leaveNote}
              </p>
            )}
            {schedule && (
              <>
                <DropdownMenuLabel className="text-ink-muted text-[11.5px] font-semibold">
                  {schedule.name} shifts
                </DropdownMenuLabel>
                {schedule.shifts.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onSet(shiftRef(schedule.id, s.id))}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        hueDot(hueOfShift(s)),
                      )}
                    />
                    <span className="flex-1">{s.label}</span>
                    <span className="text-ink-muted text-[12px]">
                      {formatHours(s.start, s.end)}
                    </span>
                  </DropdownMenuItem>
                ))}
                {schedule.shifts.some((s) => s.days.length > 0) && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Fill the week with…</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {schedule.shifts
                        .filter((s) => s.days.length > 0)
                        .map((s) => (
                          <DropdownMenuItem key={s.id} onSelect={() => onFill(s)}>
                            <span className="flex-1">{s.label}</span>
                            <span className="text-ink-muted text-[12px]">
                              {formatDays(s.days)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-ink-muted text-[11.5px] font-semibold">
              Day types
            </DropdownMenuLabel>
            {STATUS_DEFS.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => onSet(statusRef(s.id))}>
                <span
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", hueDot(s.hue))}
                />
                <span className="flex-1">{s.label}</span>
                <span className="text-ink-muted text-[12px]">{s.short}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCustom}>Custom hours or note…</DropdownMenuItem>
            <DropdownMenuCheckboxItem
              checked={current?.swap === true}
              disabled={!current}
              onCheckedChange={onSwap}
            >
              Swapped shift
            </DropdownMenuCheckboxItem>
            {current && (
              <DropdownMenuItem onSelect={onClear}>
                {current.ref === CUSTOM_REF ? "Clear custom hours" : "Clear this day"}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type LegendItem = { hue: Hue; short: string; label: string; dashed?: boolean };

const SHIFT_LEGEND: readonly LegendItem[] = [
  { hue: "s1", short: "S1", label: "Shift 1" },
  { hue: "s2", short: "S2", label: "Shift 2" },
  { hue: "s3", short: "S3", label: "Shift 3" },
  { hue: "s4", short: "S4", label: "Shift 4" },
  { hue: "s5", short: "S5", label: "Shift 5" },
  { hue: "ns", short: "NS", label: "Night shift" },
];

const DAY_LEGEND: readonly LegendItem[] = [
  { hue: "hol", short: "HOL", label: "Holiday", dashed: true },
  { hue: "leave", short: "PTO", label: "Leave", dashed: true },
  { hue: "comp", short: "COMP", label: "Comp off", dashed: true },
  { hue: "oc", short: "OC", label: "On-call", dashed: true },
  { hue: "swap", short: "⇄", label: "Swapped" },
  { hue: "custom", short: "9a", label: "Custom hours" },
];

function Swatch({ item }: { item: LegendItem }) {
  return (
    <li className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-3.5 min-w-6 rounded-sm px-1 text-center text-[9px] leading-[14px] font-bold",
          hueClass(item.hue),
          item.dashed && "border border-dashed border-current/40",
        )}
      >
        {item.short}
      </span>
      {item.label}
    </li>
  );
}

const LEGEND_SPAN = "inline-block h-3.5 w-6 shrink-0 rounded-sm";

/** One line that explains the grid's colours and marks; the hours of each team's shifts are a toggle. */
export function Legend({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="border-line text-ink-muted flex items-center gap-3 border-t px-5 py-1.5 text-[12px]">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Show each team's shift hours"
        onClick={onToggle}
        className={cn(
          "text-ink-soft hover:text-ink focus-ring rounded-control flex shrink-0 items-center gap-1.5 px-1.5 py-1 font-semibold",
          open && "bg-chip",
        )}
      >
        <CaretRightIcon
          size={12}
          weight="bold"
          className={cn("transition-transform", open && "rotate-90")}
        />
        Shift hours
      </button>
      <ul
        aria-label="Legend"
        className="scroll-thin flex min-w-0 flex-1 items-center gap-x-4 overflow-x-auto py-0.5 whitespace-nowrap"
      >
        {SHIFT_LEGEND.map((item) => (
          <Swatch key={item.label} item={item} />
        ))}
        <li aria-hidden className="bg-line-strong h-3.5 w-px shrink-0" />
        {DAY_LEGEND.map((item) => (
          <Swatch key={item.label} item={item} />
        ))}
        <li className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              LEGEND_SPAN,
              "text-amber border border-dashed border-current [background-image:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-amber)_45%,transparent)_0_2px,transparent_2px_6px)]",
            )}
          />
          Leave waiting for approval
        </li>
        <li className="flex shrink-0 items-center gap-1.5">
          <span className={cn(LEGEND_SPAN, "bg-chip border-line border")} />
          Weekend
        </li>
        <li className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              LEGEND_SPAN,
              "border-line border bg-[color-mix(in_srgb,var(--rh-hol-bg)_40%,transparent)]",
            )}
          />
          Day off for that location
        </li>
        <li className="flex shrink-0 items-center gap-1.5">
          <span className={cn(LEGEND_SPAN, "bg-accent-soft border-accent/50 border")} />
          Today
        </li>
      </ul>
    </div>
  );
}
