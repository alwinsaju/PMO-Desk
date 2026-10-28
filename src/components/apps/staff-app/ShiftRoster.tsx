"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  FileXlsIcon,
  GearSixIcon,
  LinkBreakIcon,
  MagnifyingGlassIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  addDays,
  addMonths,
  dayName,
  formatDate,
  formatDayMonth,
  formatMonth,
  formatRange,
  isWeekend,
  monthDates,
  monthStart,
  mondayOf,
  todayIso,
  weekDates,
} from "@/lib/staff/dates";
import { CUSTOM_REF, STATUS_DEFS, statusRef } from "@/lib/staff/rosterCatalog";
import { useRosterStore, useRosterSync } from "@/lib/staff/rosterStore";
import {
  BAND_LABEL,
  BAND_TONE,
  assignmentId,
  autoLinkMembers,
  bandOf,
  buildSections,
  copyPreviousWeek,
  coverageOn,
  fillWeek,
  formatDays,
  formatHours,
  indexAssignments,
  leaveOn,
  makeAssignment,
  newId,
  resolveAssignment,
  shiftRef,
  shortLabel,
  type Band,
  type CellView,
  type RosterRow,
  type RosterSection,
} from "@/lib/staff/shifts";
import { useStaffStore } from "@/lib/staff/staffStore";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import type {
  RosterConfig,
  RosterEvent,
  ShiftAssignment,
  ShiftSchedule,
  StaffChanges,
} from "@/lib/staff/types";
import { CellDialog, type CellEdit } from "./CellDialog";
import { LinkDialog } from "./LinkDialog";
import {
  ConfirmDialog,
  EmptyState,
  FilterMenu,
  PersonAvatar,
  TONE_DOT,
  TONE_PILL,
} from "./parts";
import { RosterCell, type RosterView } from "./RosterCell";
import { RosterImportDialog } from "./RosterImportDialog";
import { ScheduleDialog } from "./ScheduleDialog";

const NAME_COL = 240;
const DAY_COL: Record<RosterView, number> = { week: 112, month: 40 };
const EVENT_ROW = 28;

interface MenuTarget {
  memberId: string;
  date: string;
  rect: DOMRect;
}

const EVENT_TONE = { holiday: "amber", swap: "info", note: "neutral" } as const;

export function ShiftRoster() {
  useRosterSync();
  const config = useRosterStore((s) => s.config);
  const saveConfig = useRosterStore((s) => s.save);
  const employees = useStaffStore((s) => s.employees);
  const shifts = useStaffStore((s) => s.shifts);
  const timeOff = useStaffStore((s) => s.timeOff);
  const commit = useStaffStore((s) => s.commit);

  const today = todayIso();
  const [view, setView] = useState<RosterView>("week");
  const [anchor, setAnchor] = useState(() => mondayOf(today));
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RosterRow | null>(null);
  const [dialog, setDialog] = useState<"schedules" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const days = useMemo(
    () => (view === "week" ? weekDates(anchor) : monthDates(anchor)),
    [view, anchor],
  );
  const groupId = config.groups.find((g) => g.name === groupName)?.id ?? "";
  const { sections, excluded, total } = useMemo(
    () => buildSections(config, employees, { query, groupId }),
    [config, employees, query, groupId],
  );
  const index = useMemo(() => indexAssignments(shifts), [shifts]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const rowByMember = useMemo(() => {
    const map = new Map<string, { row: RosterRow; section: RosterSection }>();
    for (const section of sections) {
      for (const row of section.rows)
        if (row.member) map.set(row.member.id, { row, section });
    }
    return map;
  }, [sections]);

  // One view per assignment, kept while the assignment object is, so a roster
  // with thousands of days only re-renders the days that changed.
  const viewOf = useMemo(() => {
    const cache = new WeakMap<ShiftAssignment, CellView>();
    return (a: ShiftAssignment): CellView => {
      let v = cache.get(a);
      if (!v) {
        v = resolveAssignment(a, config.schedules);
        cache.set(a, v);
      }
      return v;
    };
  }, [config.schedules]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, RosterEvent[]>();
    for (const day of days) {
      const list = config.events.filter((e) => e.date <= day && day <= e.endDate);
      if (list.length) map.set(day, list);
    }
    return map;
  }, [days, config.events]);

  const copies = useMemo(
    () =>
      view === "week"
        ? copyPreviousWeek(
            shifts,
            anchor,
            rows.flatMap((r) => (r.member ? [r.member.id] : [])),
          )
        : [],
    [view, shifts, anchor, rows],
  );

  const run = useCallback(
    async (changes: StaffChanges<ShiftAssignment>) => {
      setError(null);
      const result = await commit("shifts", changes);
      if (!result.ok) setError(result.reason);
    },
    [commit],
  );

  const openMenu = useCallback((memberId: string, date: string, rect: DOMRect) => {
    setMenu({ memberId, date, rect });
  }, []);

  async function saveRoster(next: RosterConfig, done?: string) {
    setError(null);
    setNotice(null);
    const result = await saveConfig(next);
    if (!result.ok) setError(result.reason);
    else if (done) setNotice(done);
  }

  const patchMember = (
    memberId: string,
    change: Partial<RosterConfig["members"][number]>,
  ) =>
    saveRoster({
      ...config,
      members: config.members.map((m) => (m.id === memberId ? { ...m, ...change } : m)),
    });

  function addToTeam(row: RosterRow, targetGroupId: string) {
    const employee = row.employee;
    if (!employee) return;
    return saveRoster({
      ...config,
      members: [
        ...config.members,
        {
          id: newId("mem"),
          name: row.name,
          employeeId: employee.id,
          groupId: targetGroupId,
          city: employee.homeOffice,
          role: employee.team,
        },
      ],
    });
  }

  function matchNames() {
    const changed = autoLinkMembers(config.members, employees);
    if (changed.length === 0) {
      setNotice(
        "No new matches: every unlinked name is either not in the directory or matches more than one profile.",
      );
      return;
    }
    const byId = new Map(changed.map((m) => [m.id, m]));
    void saveRoster(
      { ...config, members: config.members.map((m) => byId.get(m.id) ?? m) },
      `Linked ${changed.length} ${changed.length === 1 ? "person" : "people"} to their directory profile.`,
    );
  }

  function navigate(direction: -1 | 1) {
    setAnchor((a) =>
      view === "week" ? addDays(a, 7 * direction) : addMonths(a, direction),
    );
  }

  function switchView(next: RosterView) {
    if (next === view) return;
    setView(next);
    setAnchor((a) => (next === "month" ? monthStart(a) : mondayOf(a)));
  }

  const target = menu ? rowByMember.get(menu.memberId) : undefined;
  const targetSchedule: ShiftSchedule | undefined = target?.section.schedule;
  const targetKey = menu ? assignmentId(menu.memberId, menu.date) : "";
  const targetCurrent = menu ? (index.get(targetKey) ?? null) : null;

  const setRef = (ref: string) =>
    menu && run({ upsert: [makeAssignment(menu.memberId, menu.date, ref)] });

  const hasPeople =
    config.members.length > 0 || employees.some((e) => !e.excludeFromShiftRoster);
  const todayInView = days.includes(today);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            variant="outline"
            size="sm"
            onClick={() => navigate(-1)}
          >
            <CaretLeftIcon weight="bold" />
          </IconButton>
          <IconButton
            aria-label={view === "week" ? "Next week" : "Next month"}
            variant="outline"
            size="sm"
            onClick={() => navigate(1)}
          >
            <CaretRightIcon weight="bold" />
          </IconButton>
        </div>
        <h2 className="text-ink min-w-[150px] text-[15px] font-bold" aria-live="polite">
          {view === "week"
            ? formatRange(days[0], days[days.length - 1])
            : formatMonth(anchor)}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={todayInView}
          onClick={() => setAnchor(view === "week" ? mondayOf(today) : monthStart(today))}
        >
          Today
        </Button>
        <div
          role="group"
          aria-label="Range"
          className="bg-chip rounded-seg inline-flex gap-0.5 p-0.5"
        >
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => switchView(v)}
              className={cn(
                "rounded-seg-item transition-ui h-7 px-3 text-[13px] font-semibold capitalize",
                view === v
                  ? "bg-field text-ink shadow-[0_2px_8px_rgba(30,30,60,0.12)]"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="relative ml-auto max-w-[220px] min-w-[160px] flex-1">
          <MagnifyingGlassIcon
            size={15}
            className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            aria-label="Search people in the roster"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-9 text-[13px]"
          />
        </div>
        <FilterMenu
          label="teams"
          value={groupName}
          options={config.groups.map((g) => g.name)}
          onChange={setGroupName}
        />
        {view === "week" && (
          <Button
            variant="outline"
            size="sm"
            disabled={copies.length === 0}
            title="Fill empty days this week with last week's shifts"
            onClick={() => void run({ upsert: copies })}
          >
            <CopyIcon size={14} weight="bold" />
            Copy last week
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Manage the shift roster">
              <GearSixIcon size={14} weight="bold" />
              Manage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog("schedules")}>
              Schedules and teams…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("import")}>
              Import from Excel…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={matchNames}>
              Match names to the directory
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(excluded > 0 || notice) && (
        <p role="status" className="text-ink-muted px-5 pb-2 text-[12.5px]">
          {notice ??
            `${excluded} ${excluded === 1 ? "person is" : "people are"} excluded from the shift roster. Change this on their profile in the Directory.`}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red flex items-start gap-2 px-5 pb-2 text-[13px]">
          <WarningCircleIcon size={16} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 pb-2">
        {!hasPeople ? (
          <EmptyState
            icon={<UsersThreeIcon size={26} />}
            title="No one on the shift roster yet"
            actions={
              <Button onClick={() => setDialog("import")}>
                <FileXlsIcon size={16} weight="bold" />
                Import from Excel
              </Button>
            }
          >
            People in the Directory appear here unless they are excluded from the shift
            roster. To start from your existing workbook, import it: teams, schedules,
            people and their shifts come across.
          </EmptyState>
        ) : total === 0 && (query || groupName) ? (
          <EmptyState icon={<MagnifyingGlassIcon size={26} />} title="No one matches">
            Try a different name or team.
          </EmptyState>
        ) : (
          <table
            className="border-line border-separate border-spacing-0 border"
            style={{
              tableLayout: "fixed",
              width: view === "week" ? "100%" : NAME_COL + days.length * DAY_COL[view],
              minWidth: NAME_COL + days.length * DAY_COL[view],
            }}
          >
            <colgroup>
              <col style={{ width: NAME_COL }} />
              {days.map((day) => (
                <col key={day} style={{ width: DAY_COL[view] }} />
              ))}
            </colgroup>
            <thead className="bg-surface-elevated">
              <tr>
                <th
                  scope="col"
                  rowSpan={2}
                  className="border-line text-ink-muted bg-surface-elevated sticky top-0 left-0 z-[4] border-b px-4 text-left align-bottom text-[11.5px] font-bold tracking-[0.06em] uppercase"
                >
                  Employee
                </th>
                {days.map((day) => {
                  const events = eventsByDay.get(day);
                  return (
                    <th
                      key={day}
                      scope="col"
                      style={{ height: EVENT_ROW }}
                      className="bg-surface-elevated sticky top-0 z-[3] border-l border-transparent p-0"
                    >
                      {events && (
                        <div
                          title={events.map((e) => e.label).join(" · ")}
                          className={cn(
                            "text-ink-soft mx-[2px] truncate rounded-sm px-1 text-[10px] leading-[18px] font-semibold",
                            TONE_PILL[EVENT_TONE[events[0].kind]],
                          )}
                        >
                          {view === "week" ? events.map((e) => e.label).join(" · ") : "•"}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
              <tr>
                {days.map((day) => {
                  const isToday = day === today;
                  return (
                    <th
                      key={day}
                      scope="col"
                      style={{ top: EVENT_ROW }}
                      className={cn(
                        "border-line bg-surface-elevated sticky z-[3] border-b border-l px-1 py-1.5 text-center",
                        isWeekend(day) && "bg-chip",
                      )}
                    >
                      <span className="text-ink-muted block text-[10.5px] font-bold tracking-[0.06em] uppercase">
                        {dayName(day)}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 inline-block rounded-full px-1.5 text-[12px] font-semibold",
                          isToday ? "bg-accent text-accent-contrast" : "text-ink",
                        )}
                      >
                        {view === "week"
                          ? formatDayMonth(day)
                          : day.slice(8).replace(/^0/, "")}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.id}>
                <tr>
                  <td
                    colSpan={days.length + 1}
                    className="border-line bg-chip border-b p-0"
                  >
                    <SectionHeader section={section} />
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className="border-line bg-surface-elevated sticky left-0 z-[2] border-b px-3 py-1.5 text-left font-normal"
                    >
                      <PersonCell
                        row={row}
                        section={section}
                        groups={config.groups}
                        onLink={() => row.member && setLinking(row.member.id)}
                        onUnlink={() =>
                          row.member &&
                          void patchMember(row.member.id, { employeeId: null })
                        }
                        onMove={(gid) =>
                          row.member
                            ? void patchMember(row.member.id, { groupId: gid })
                            : void addToTeam(row, gid)
                        }
                        onRemove={() => setRemoving(row)}
                      />
                    </th>
                    {days.map((day) => {
                      const a = row.member
                        ? index.get(assignmentId(row.member.id, day))
                        : undefined;
                      const leave =
                        row.employee && !a
                          ? leaveOn(timeOff, row.employee.id, day)
                          : undefined;
                      return (
                        <RosterCell
                          key={day}
                          view={view}
                          memberId={row.member?.id ?? null}
                          date={day}
                          cell={a ? viewOf(a) : null}
                          leave={leave ? TIME_OFF_META[leave.type].label : null}
                          weekend={isWeekend(day)}
                          marked={
                            eventsByDay.get(day)?.some((e) => e.kind === "holiday") ??
                            false
                          }
                          who={row.name}
                          onOpen={openMenu}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <th
                  scope="row"
                  className="text-ink-muted bg-chip sticky left-0 z-[2] px-4 py-2.5 text-left text-[12px] font-bold tracking-[0.06em] uppercase"
                >
                  On shift
                </th>
                {days.map((day) => (
                  <td
                    key={day}
                    className="bg-chip text-ink border-line border-l px-1 py-2.5 text-center text-[12.5px] font-bold"
                  >
                    {coverageOn(day, rows, index, config.schedules, timeOff)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <Legend />

      <CellMenu
        menu={menu}
        schedule={targetSchedule}
        name={target?.row.name ?? ""}
        current={targetCurrent}
        onClose={() => setMenu(null)}
        onSet={setRef}
        onFill={(def) =>
          menu &&
          targetSchedule &&
          void run({
            upsert: fillWeek(mondayOf(menu.date), menu.memberId, targetSchedule.id, def),
          })
        }
        onSwap={(swap) =>
          menu &&
          targetCurrent &&
          void run({
            upsert: [
              makeAssignment(menu.memberId, menu.date, targetCurrent.ref, {
                text: targetCurrent.text,
                swap,
                note: targetCurrent.note,
              }),
            ],
          })
        }
        onCustom={() =>
          menu &&
          setCellEdit({
            memberId: menu.memberId,
            date: menu.date,
            who: target?.row.name ?? "",
            current: targetCurrent,
          })
        }
        onClear={() => menu && void run({ remove: [targetKey] })}
      />
      <CellDialog
        edit={cellEdit}
        onClose={() => setCellEdit(null)}
        onSave={(next) => {
          if (!cellEdit) return;
          void run({
            upsert: [
              makeAssignment(cellEdit.memberId, cellEdit.date, next.ref, {
                text: next.text,
                swap: next.swap,
                note: next.note,
              }),
            ],
          });
          setCellEdit(null);
        }}
      />
      <LinkDialog
        memberName={
          linking ? (config.members.find((m) => m.id === linking)?.name ?? null) : null
        }
        employees={employees}
        linkedIds={
          new Set(
            config.members
              .filter((m) => m.id !== linking)
              .map((m) => m.employeeId)
              .filter((id): id is string => !!id),
          )
        }
        onClose={() => setLinking(null)}
        onPick={(employeeId) => {
          if (linking) void patchMember(linking, { employeeId });
          setLinking(null);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "this person"} from the shift roster?`}
        description="Their shifts on the roster are deleted. Their directory profile, if they have one, is not touched."
        confirmLabel="Remove"
        onOpenChange={(open) => !open && setRemoving(null)}
        onConfirm={() => {
          const member = removing?.member;
          setRemoving(null);
          if (member) {
            void saveRoster({
              ...config,
              members: config.members.filter((m) => m.id !== member.id),
            });
          }
        }}
      />
      <ScheduleDialog
        open={dialog === "schedules"}
        onOpenChange={(o) => !o && setDialog(null)}
      />
      <RosterImportDialog
        open={dialog === "import"}
        onOpenChange={(o) => !o && setDialog(null)}
      />
    </div>
  );
}

function Chip({ band, children }: { band: Band; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-chip inline-flex h-6 items-center gap-1.5 px-2.5 text-[11.5px] leading-none font-semibold whitespace-nowrap",
        TONE_PILL[BAND_TONE[band]],
      )}
    >
      {children}
    </span>
  );
}

/** The team's name and its legend: each shift with its hours. The same name can
 *  mean different hours in another team, so every section shows its own. */
function SectionHeader({ section }: { section: RosterSection }) {
  const { group, schedule, rows } = section;
  return (
    <div className="sticky left-0 flex w-[min(100%,980px)] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
      <h3 className="text-ink text-[13.5px] font-bold">
        {group ? group.name : "Not in a team yet"}
        <span className="text-ink-muted ml-1.5 font-semibold">{rows.length}</span>
      </h3>
      {group && schedule && (
        <>
          <span className="text-ink-muted text-[12px]">Schedule: {schedule.name}</span>
          <ul className="flex flex-wrap gap-1.5" aria-label={`${schedule.name} shifts`}>
            {schedule.shifts.map((s) => (
              <li key={s.id}>
                <Chip band={bandOf(s.start)}>
                  {shortLabel(s.label)}
                  <span className="font-medium opacity-80">
                    {formatHours(s.start, s.end)}
                    {s.days.length > 0 && ` · ${formatDays(s.days)}`}
                  </span>
                </Chip>
              </li>
            ))}
          </ul>
        </>
      )}
      {!group && (
        <span className="text-ink-muted text-[12px]">
          In the directory and included in the shift roster. Choose a team for each person
          to start planning their shifts.
        </span>
      )}
    </div>
  );
}

function PersonCell({
  row,
  section,
  groups,
  onLink,
  onUnlink,
  onMove,
  onRemove,
}: {
  row: RosterRow;
  section: RosterSection;
  groups: RosterConfig["groups"];
  onLink: () => void;
  onUnlink: () => void;
  onMove: (groupId: string) => void;
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
        <p className="text-ink-muted truncate text-[11.5px]">
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
function CellMenu({
  menu,
  schedule,
  name,
  current,
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
        className="max-h-[70vh] min-w-[250px] overflow-y-auto"
      >
        {menu && (
          <>
            <DropdownMenuLabel>
              {name} · {formatDate(menu.date)}
            </DropdownMenuLabel>
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
                        TONE_DOT[BAND_TONE[bandOf(s.start)]],
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
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TONE_DOT[s.tone])}
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

function Legend() {
  return (
    <ul
      aria-label="Legend"
      className="border-line text-ink-muted flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t px-5 py-2.5 text-[12px]"
    >
      <li className="text-ink-faint">Colour follows when the shift starts:</li>
      {(Object.keys(BAND_LABEL) as Band[]).map((band) => (
        <li key={band} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT[BAND_TONE[band]])} />
          {BAND_LABEL[band]}
        </li>
      ))}
      <li className="text-ink-faint">Dashed:</li>
      {STATUS_DEFS.slice(0, 5).map((s) => (
        <li key={s.id} className="flex items-center gap-1.5" title={s.description}>
          <span
            className={cn(
              "inline-block h-3 min-w-6 rounded-sm border border-dashed border-current/40 px-1 text-center text-[9px] leading-[11px] font-bold",
              TONE_PILL[s.tone],
            )}
          >
            {s.short}
          </span>
          {s.label}
        </li>
      ))}
    </ul>
  );
}
