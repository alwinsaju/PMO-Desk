"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  FileXlsIcon,
  GearSixIcon,
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
  cycleContaining,
  cycleDates,
  cycleSpan,
  nextCycle,
  previousCycle,
} from "@/lib/staff/cycles";
import {
  addDays,
  addMonths,
  dayName,
  formatDate,
  formatMonth,
  formatRange,
  monthDates,
  monthStart,
  mondayOf,
  todayIso,
  weekDates,
} from "@/lib/staff/dates";
import { locationChoices } from "@/lib/staff/holidays";
import { useRosterStore, useRosterSync } from "@/lib/staff/rosterStore";
import {
  assignmentId,
  autoLinkMembers,
  buildSections,
  copyPreviousWeek,
  fillWeek,
  indexAssignments,
  leaveOn,
  makeAssignment,
  newId,
  resolveAssignment,
  withGroup,
  type CellView,
  type RosterRow,
  type RosterSection,
} from "@/lib/staff/shifts";
import { useStaffStore } from "@/lib/staff/staffStore";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import type {
  RosterConfig,
  RosterEvent,
  RosterGroup,
  RosterMember,
  ShiftAssignment,
  StaffChanges,
} from "@/lib/staff/types";
import { CellDialog, type CellEdit } from "./CellDialog";
import { DayView } from "./DayView";
import { HolidayDialog } from "./HolidayDialog";
import { LinkDialog } from "./LinkDialog";
import { readSetting, writeSetting } from "./localSetting";
import { ConfirmDialog, EmptyState, FilterMenu } from "./parts";
import type { RosterView } from "./RosterCell";
import { RosterGrid, type GridActions } from "./RosterGrid";
import { CellMenu, Legend, type MenuTarget } from "./RosterParts";
import { RosterImportDialog } from "./RosterImportDialog";
import { ScheduleDialog } from "./ScheduleDialog";

const VIEWS: readonly RosterView[] = ["today", "week", "month", "cycle"];
const LEGEND_KEY = "ai-os:staff:roster-legend";
const VIEW_LABEL: Record<RosterView, string> = {
  today: "Day",
  week: "Week",
  month: "Month",
  cycle: "Cycle",
};
const UNIT: Record<RosterView, string> = {
  today: "day",
  week: "week",
  month: "month",
  cycle: "cycle",
};

/** The day, Monday, first of the month or cycle start that `view` is anchored on for `focus`. */
function anchorFor(view: RosterView, focus: string): string {
  switch (view) {
    case "today":
      return focus;
    case "week":
      return mondayOf(focus);
    case "month":
      return monthStart(focus);
    case "cycle":
      return cycleContaining(focus).start;
  }
}

function rangeOf(view: RosterView, anchor: string) {
  switch (view) {
    case "today":
      return {
        days: [anchor],
        title: `${dayName(anchor)}, ${formatDate(anchor)}`,
        subtitle: "",
      };
    case "week": {
      const days = weekDates(anchor);
      return { days, title: formatRange(days[0], days[6]), subtitle: "" };
    }
    case "month":
      return { days: monthDates(anchor), title: formatMonth(anchor), subtitle: "" };
    case "cycle": {
      const cycle = cycleContaining(anchor);
      return {
        days: cycleDates(cycle),
        title: `${cycle.label} cycle`,
        subtitle: cycleSpan(cycle),
      };
    }
  }
}

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
  const [legendOpen, setLegendOpen] = useState(() => readSetting(LEGEND_KEY) === "open");
  const toggleLegend = () => {
    writeSetting(LEGEND_KEY, legendOpen ? "closed" : "open");
    setLegendOpen(!legendOpen);
  };
  const [groupName, setGroupName] = useState("");
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [cellEdit, setCellEdit] = useState<CellEdit | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RosterRow | null>(null);
  const [dialog, setDialog] = useState<"schedules" | "import" | "holidays" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const materialising = useRef(new Map<string, Promise<string | null>>());

  const { days, title, subtitle } = useMemo(() => rangeOf(view, anchor), [view, anchor]);
  const { sections, teams, excluded, total, hiddenPeople } = useMemo(
    () => buildSections(config, employees, { query, groupId: groupName }),
    [config, employees, query, groupName],
  );
  const teamGroups = useMemo<RosterGroup[]>(
    () =>
      teams.map((t) => ({
        id: t.id,
        name: t.name,
        scheduleId: t.scheduleId,
        ...(t.hidden ? { hidden: true } : {}),
      })),
    [teams],
  );
  const index = useMemo(() => indexAssignments(shifts), [shifts]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const rowByKey = useMemo(() => {
    const map = new Map<string, { row: RosterRow; section: RosterSection }>();
    for (const section of sections) {
      for (const row of section.rows) map.set(row.key, { row, section });
    }
    return map;
  }, [sections]);
  const approved = useMemo(
    () => timeOff.filter((r) => r.status === "approved"),
    [timeOff],
  );
  const choices = useMemo(
    () => locationChoices(config.members, employees, config.events),
    [config.members, config.events, employees],
  );
  const linkable = useMemo(
    () => autoLinkMembers(config.members, employees).length,
    [config.members, employees],
  );

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

  const openMenu = useCallback((rowKey: string, date: string, rect: DOMRect) => {
    setMenu({ rowKey, date, rect });
  }, []);

  async function saveRoster(next: RosterConfig, done?: string): Promise<boolean> {
    setError(null);
    setNotice(null);
    const result = await saveConfig(next);
    if (!result.ok) setError(result.reason);
    else if (done) setNotice(done);
    return result.ok;
  }

  /** The latest saved configuration, for actions that follow another save. */
  const latest = () => useRosterStore.getState().config;

  /** `base` with the team stored, when only the directory has named it so far. */
  const withTeam = (base: RosterConfig, groupId: string): RosterConfig => {
    const team = teamGroups.find((g) => g.id === groupId);
    return team ? withGroup(base, team) : base;
  };

  const patchMember = (memberId: string, change: Partial<RosterMember>) => {
    const current = latest();
    const base = change.groupId ? withTeam(current, change.groupId) : current;
    return saveRoster({
      ...base,
      members: base.members.map((m) => (m.id === memberId ? { ...m, ...change } : m)),
    });
  };

  /**
   * The roster member behind a row. A directory person has no roster entry until
   * something is entered for them: it is created here, together with their team when
   * only the directory names it, and the id is returned.
   */
  function ensureMember(rowKey: string): Promise<string | null> {
    const found = rowByKey.get(rowKey);
    if (!found) return Promise.resolve(null);
    const { row, section } = found;
    if (row.member) return Promise.resolve(row.member.id);
    const employee = row.employee;
    const group = section.group;
    if (!employee || !group) return Promise.resolve(null);
    const pending = materialising.current.get(row.key);
    if (pending) return pending;
    const task = (async () => {
      const current = latest();
      const member: RosterMember = {
        id: newId("mem"),
        name: row.name,
        employeeId: employee.id,
        groupId: group.id,
        city: employee.homeOffice,
        role: employee.team,
      };
      const ok = await saveRoster({
        ...withGroup(current, group),
        members: [...current.members, member],
      });
      return ok ? member.id : null;
    })().finally(() => materialising.current.delete(row.key));
    materialising.current.set(row.key, task);
    return task;
  }

  function addToTeam(row: RosterRow, targetGroupId: string) {
    const employee = row.employee;
    if (!employee) return;
    const current = withTeam(latest(), targetGroupId);
    return saveRoster({
      ...current,
      members: [
        ...current.members,
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

  function setTeamHidden(group: RosterGroup, hidden: boolean) {
    const base = withGroup(latest(), group);
    return saveRoster({
      ...base,
      groups: base.groups.map((g) =>
        g.id === group.id ? { ...g, hidden: hidden ? true : undefined } : g,
      ),
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

  const actions: GridActions = {
    open: openMenu,
    link: (row) => row.member && setLinking(row.member.id),
    unlink: (row) => {
      if (row.member) void patchMember(row.member.id, { employeeId: null });
    },
    move: (row, gid) => {
      if (row.member) void patchMember(row.member.id, { groupId: gid });
      else void addToTeam(row, gid);
    },
    setLocation: (row, location) => {
      void ensureMember(row.key).then((id) => {
        if (id) void patchMember(id, { city: location });
      });
    },
    remove: setRemoving,
    hide: (section) => section.group && void setTeamHidden(section.group, true),
  };

  function navigate(direction: -1 | 1) {
    setAnchor((a) => {
      switch (view) {
        case "today":
          return addDays(a, direction);
        case "week":
          return addDays(a, 7 * direction);
        case "month":
          return addMonths(a, direction);
        case "cycle": {
          const cycle = cycleContaining(a);
          return (direction > 0 ? nextCycle(cycle) : previousCycle(cycle)).start;
        }
      }
    });
  }

  function switchView(next: RosterView) {
    if (next === view) return;
    const focus = days.includes(today) ? today : days[0];
    setView(next);
    setAnchor(anchorFor(next, focus));
  }

  const target = menu ? rowByKey.get(menu.rowKey) : undefined;
  const targetMemberId = target?.row.member?.id ?? null;
  const targetCurrent =
    menu && targetMemberId
      ? (index.get(assignmentId(targetMemberId, menu.date)) ?? null)
      : null;
  const targetLeave =
    menu && target?.row.employee
      ? leaveOn(approved, target.row.employee.id, menu.date)
      : undefined;

  async function setRef(ref: string) {
    if (!menu) return;
    const memberId = await ensureMember(menu.rowKey);
    if (memberId) await run({ upsert: [makeAssignment(memberId, menu.date, ref)] });
  }

  const hasPeople =
    config.members.length > 0 || employees.some((e) => !e.excludeFromShiftRoster);
  const todayInView = days.includes(today);
  const visibleTeams = teams.filter((t) => !t.hidden);
  const hiddenTeams = teams.length - visibleTeams.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={`Previous ${UNIT[view]}`}
            variant="outline"
            size="sm"
            onClick={() => navigate(-1)}
          >
            <CaretLeftIcon weight="bold" />
          </IconButton>
          <IconButton
            aria-label={`Next ${UNIT[view]}`}
            variant="outline"
            size="sm"
            onClick={() => navigate(1)}
          >
            <CaretRightIcon weight="bold" />
          </IconButton>
        </div>
        <div className="shrink-0" aria-live="polite">
          <h2 className="text-ink text-[15px] leading-tight font-bold whitespace-nowrap">
            {title}
          </h2>
          {subtitle && <p className="text-ink-muted text-[11.5px]">{subtitle}</p>}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={todayInView}
          title={todayInView ? "Today is already in view" : undefined}
          onClick={() => setAnchor(anchorFor(view, today))}
        >
          Today
        </Button>
        <div
          role="group"
          aria-label="Range"
          className="bg-chip rounded-seg inline-flex gap-0.5 p-0.5"
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => switchView(v)}
              className={cn(
                "rounded-seg-item transition-ui h-7 px-3 text-[13px] font-semibold",
                view === v
                  ? "bg-field text-ink shadow-[0_2px_8px_rgba(30,30,60,0.12)]"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>

        <div className="relative ml-auto max-w-[220px] min-w-[130px] flex-1">
          <MagnifyingGlassIcon
            size={15}
            className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            {...noSpellcheck}
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
          options={visibleTeams.map((t) => t.name)}
          onChange={setGroupName}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More roster actions">
              <DotsThreeIcon size={16} weight="bold" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[230px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <EyeIcon size={14} weight="bold" />
                Show or hide teams
                {hiddenTeams > 0 && (
                  <span className="text-ink-muted ml-auto pl-3 text-[12px]">
                    {hiddenTeams} hidden
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[360px] min-w-[230px] overflow-y-auto">
                <DropdownMenuLabel>Teams shown in the roster</DropdownMenuLabel>
                {teams.length === 0 && (
                  <p className="text-ink-muted px-3 py-2 text-[12.5px]">No teams yet.</p>
                )}
                {teams.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={!t.hidden}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(show) =>
                      void setTeamHidden(
                        { id: t.id, name: t.name, scheduleId: t.scheduleId },
                        !show,
                      )
                    }
                  >
                    <span className="flex-1">{t.name}</span>
                    <span className="text-ink-muted ml-3 text-[12px]">{t.count}</span>
                  </DropdownMenuCheckboxItem>
                ))}
                {hiddenTeams > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        const current = latest();
                        void saveRoster({
                          ...current,
                          groups: current.groups.map((g) =>
                            g.hidden ? { ...g, hidden: undefined } : g,
                          ),
                        });
                      }}
                    >
                      Show all teams
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {view === "week" && (
              <DropdownMenuItem
                disabled={copies.length === 0}
                onSelect={() => void run({ upsert: copies })}
              >
                <CopyIcon size={14} weight="bold" />
                Copy last week
                <span className="text-ink-muted ml-auto pl-3 text-[12px]">
                  fills empty days
                </span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog("schedules")}>
              <GearSixIcon size={14} weight="bold" />
              Schedules and teams…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("holidays")}>
              <CalendarDotsIcon size={14} weight="bold" />
              Holidays by location…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("import")}>
              <FileXlsIcon size={14} weight="bold" />
              Import from Excel…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={matchNames}>
              Match names to the directory
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(excluded > 0 || hiddenPeople > 0 || notice || linkable > 0) && (
        <p role="status" className="text-ink-muted px-5 pb-2 text-[12.5px]">
          {notice ?? (
            <>
              {excluded > 0 &&
                `${excluded} ${excluded === 1 ? "person is" : "people are"} excluded from the shift roster (change it on their Directory profile). `}
              {hiddenPeople > 0 &&
                `${hiddenPeople} ${hiddenPeople === 1 ? "person is" : "people are"} in hidden teams. `}
              {linkable > 0 && (
                <>
                  {linkable} roster {linkable === 1 ? "name matches" : "names match"} a
                  directory profile.{" "}
                  <button
                    type="button"
                    className="text-accent-ink font-semibold underline"
                    onClick={matchNames}
                  >
                    Link them
                  </button>
                </>
              )}
            </>
          )}
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
            People in the Directory appear here, in the team named on their profile,
            unless they are excluded from the shift roster. To start from your existing
            workbook, import it: teams, schedules, people and their shifts come across.
          </EmptyState>
        ) : total === 0 && (query || groupName) ? (
          <EmptyState icon={<MagnifyingGlassIcon size={26} />} title="No one matches">
            Try a different name or team.
          </EmptyState>
        ) : total === 0 ? (
          <EmptyState icon={<EyeIcon size={26} />} title="Every team is hidden">
            Use the Teams menu to show a team again.
          </EmptyState>
        ) : view === "today" ? (
          <DayView
            date={anchor}
            today={today}
            sections={sections}
            index={index}
            viewOf={viewOf}
            timeOff={timeOff}
            eventsByDay={eventsByDay}
            choices={choices}
            onOpen={openMenu}
            onHide={actions.hide}
          />
        ) : (
          <RosterGrid
            view={view}
            days={days}
            today={today}
            sections={sections}
            config={config}
            groups={teamGroups}
            index={index}
            viewOf={viewOf}
            timeOff={timeOff}
            eventsByDay={eventsByDay}
            choices={choices}
            actions={actions}
            showShifts={legendOpen}
          />
        )}
      </div>

      <Legend open={legendOpen} onToggle={toggleLegend} />

      <CellMenu
        menu={menu}
        schedule={target?.section.schedule}
        name={target?.row.name ?? ""}
        current={targetCurrent}
        leaveNote={
          targetLeave
            ? `Approved ${TIME_OFF_META[targetLeave.type].label} in the Time off tab covers this day, so the roster shows it instead of the shift.`
            : null
        }
        onClose={() => setMenu(null)}
        onSet={(ref) => void setRef(ref)}
        onFill={(def) => {
          const schedule = target?.section.schedule;
          if (!menu || !schedule) return;
          void ensureMember(menu.rowKey).then((id) => {
            if (id) {
              void run({ upsert: fillWeek(mondayOf(menu.date), id, schedule.id, def) });
            }
          });
        }}
        onSwap={(swap) =>
          menu &&
          targetCurrent &&
          void run({
            upsert: [
              makeAssignment(targetCurrent.memberId, menu.date, targetCurrent.ref, {
                text: targetCurrent.text,
                swap,
                note: targetCurrent.note,
              }),
            ],
          })
        }
        onCustom={() => {
          if (!menu) return;
          void ensureMember(menu.rowKey).then((id) => {
            if (id) {
              setCellEdit({
                memberId: id,
                date: menu.date,
                who: target?.row.name ?? "",
                current: targetCurrent,
              });
            }
          });
        }}
        onClear={() =>
          menu && targetMemberId
            ? void run({ remove: [assignmentId(targetMemberId, menu.date)] })
            : undefined
        }
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
        description={
          removing?.employee
            ? "Their shifts on the roster are deleted. They are in the Directory, so they stay listed here with an empty schedule; exclude them on their profile to keep them off the roster."
            : "Their shifts on the roster are deleted. They are not in the Directory, so nothing else is touched."
        }
        confirmLabel="Remove"
        onOpenChange={(open) => !open && setRemoving(null)}
        onConfirm={() => {
          const member = removing?.member;
          setRemoving(null);
          if (member) {
            const current = latest();
            void saveRoster({
              ...current,
              members: current.members.filter((m) => m.id !== member.id),
            });
          }
        }}
      />
      <ScheduleDialog
        open={dialog === "schedules"}
        onOpenChange={(o) => !o && setDialog(null)}
      />
      <HolidayDialog
        open={dialog === "holidays"}
        onOpenChange={(o) => !o && setDialog(null)}
      />
      <RosterImportDialog
        open={dialog === "import"}
        onOpenChange={(o) => !o && setDialog(null)}
      />
    </div>
  );
}
