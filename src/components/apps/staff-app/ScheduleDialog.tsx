"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  IconButton,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { slugify } from "@/lib/staff/rosterCatalog";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { BAND_TONE, bandOf, formatDays, formatHours, newId } from "@/lib/staff/shifts";
import type { RosterConfig, ShiftDef, ShiftSchedule } from "@/lib/staff/types";
import { SELECT_CLASS, TONE_DOT } from "./parts";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function ScheduleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <Body onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function uniqueId(base: string, taken: readonly string[], fallback: string): string {
  const root = slugify(base) || fallback;
  if (!taken.includes(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

function Body({ onClose }: { onClose: () => void }) {
  const stored = useRosterStore((s) => s.config);
  const save = useRosterStore((s) => s.save);
  const shifts = useStaffStore((s) => s.shifts);
  const [draft, setDraft] = useState<RosterConfig>(() => structuredClone(stored));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** How many days use each `<schedule>:<shift>`. */
  const used = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of shifts) counts.set(s.ref, (counts.get(s.ref) ?? 0) + 1);
    return counts;
  }, [shifts]);

  const patchSchedule = (id: string, change: (s: ShiftSchedule) => ShiftSchedule) =>
    setDraft((d) => ({
      ...d,
      schedules: d.schedules.map((s) => (s.id === id ? change(s) : s)),
    }));

  const patchShift = (scheduleId: string, shiftId: string, change: Partial<ShiftDef>) =>
    patchSchedule(scheduleId, (s) => ({
      ...s,
      shifts: s.shifts.map((x) => (x.id === shiftId ? { ...x, ...change } : x)),
    }));

  function addSchedule(copyOf?: ShiftSchedule) {
    setDraft((d) => {
      const name = copyOf ? `${copyOf.name} copy` : "New schedule";
      const id = uniqueId(
        name,
        d.schedules.map((s) => s.id).concat("status", "custom"),
        "schedule",
      );
      return {
        ...d,
        schedules: [
          ...d.schedules,
          { id, name, shifts: copyOf ? structuredClone(copyOf.shifts) : [] },
        ],
      };
    });
  }

  function addShift(schedule: ShiftSchedule) {
    patchSchedule(schedule.id, (s) => {
      const label = `Shift-${s.shifts.length + 1}`;
      const id = uniqueId(
        label,
        s.shifts.map((x) => x.id),
        "shift",
      );
      return {
        ...s,
        shifts: [...s.shifts, { id, label, start: "09:00", end: "18:00", days: [] }],
      };
    });
  }

  function move(index: number, by: -1 | 1) {
    setDraft((d) => {
      const groups = [...d.groups];
      const to = index + by;
      if (to < 0 || to >= groups.length) return d;
      [groups[index], groups[to]] = [groups[to], groups[index]];
      return { ...d, groups };
    });
  }

  function validate(): string | null {
    for (const s of draft.schedules) {
      if (!s.name.trim()) return "Every schedule needs a name.";
      for (const x of s.shifts) {
        if (!x.label.trim()) return `A shift in ${s.name} has no name.`;
        if (x.start === x.end)
          return `${x.label} in ${s.name} starts and ends at the same time.`;
      }
    }
    for (const g of draft.groups) {
      if (!g.name.trim()) return "Every team needs a name.";
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const result = await save({
      ...draft,
      schedules: draft.schedules.map((s) => ({ ...s, name: s.name.trim() })),
      groups: draft.groups.map((g) => ({ ...g, name: g.name.trim() })),
    });
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    onClose();
  }

  const membersIn = (groupId: string) =>
    draft.members.filter((m) => m.groupId === groupId).length;
  const teamsUsing = (scheduleId: string) =>
    draft.groups.filter((g) => g.scheduleId === scheduleId);

  return (
    <>
      <DialogTitle>Schedules and teams</DialogTitle>
      <DialogDescription>
        A schedule is the set of shifts one team works. Two teams can both have a
        “Shift-1” with different hours: each team uses its own schedule.
      </DialogDescription>

      <Tabs defaultValue="schedules" className="mt-5">
        <TabsList aria-label="What to edit">
          <TabsTrigger value="schedules" count={draft.schedules.length}>
            Schedules
          </TabsTrigger>
          <TabsTrigger value="teams" count={draft.groups.length}>
            Teams
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="mt-4 flex flex-col gap-4">
          {draft.schedules.map((schedule) => {
            const teams = teamsUsing(schedule.id);
            return (
              <section
                key={schedule.id}
                className="border-line bg-card rounded-card border p-4"
                aria-label={`Schedule ${schedule.name}`}
              >
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Schedule name"
                    value={schedule.name}
                    maxLength={60}
                    onChange={(e) =>
                      patchSchedule(schedule.id, (s) => ({ ...s, name: e.target.value }))
                    }
                    className="h-8 max-w-[240px] font-semibold"
                  />
                  <span className="text-ink-muted min-w-0 flex-1 truncate text-[12.5px]">
                    {teams.length > 0
                      ? `Used by ${teams.map((t) => t.name).join(", ")}`
                      : "Not used by any team"}
                  </span>
                  <IconButton
                    aria-label={`Duplicate ${schedule.name}`}
                    title="Duplicate"
                    size="sm"
                    onClick={() => addSchedule(schedule)}
                  >
                    <CopyIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${schedule.name}`}
                    title={teams.length ? "A team still uses it" : "Delete"}
                    size="sm"
                    disabled={teams.length > 0 || draft.schedules.length <= 1}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        schedules: d.schedules.filter((s) => s.id !== schedule.id),
                      }))
                    }
                  >
                    <TrashIcon />
                  </IconButton>
                </div>

                <ul className="mt-3 flex flex-col gap-2">
                  {schedule.shifts.map((x) => {
                    const days = used.get(`${schedule.id}:${x.id}`) ?? 0;
                    const tone = BAND_TONE[bandOf(x.start)];
                    return (
                      <li
                        key={x.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
                      >
                        <span
                          className={cn(
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            TONE_DOT[tone],
                          )}
                        />
                        <Input
                          aria-label="Shift name"
                          value={x.label}
                          maxLength={30}
                          onChange={(e) =>
                            patchShift(schedule.id, x.id, { label: e.target.value })
                          }
                          className="h-8 w-[120px]"
                        />
                        <Input
                          aria-label={`${x.label} starts`}
                          type="time"
                          value={x.start}
                          onChange={(e) =>
                            e.target.value &&
                            patchShift(schedule.id, x.id, { start: e.target.value })
                          }
                          className="h-8 w-[136px]"
                        />
                        <span className="text-ink-muted text-[12px]">to</span>
                        <Input
                          aria-label={`${x.label} ends`}
                          type="time"
                          value={x.end}
                          onChange={(e) =>
                            e.target.value &&
                            patchShift(schedule.id, x.id, { end: e.target.value })
                          }
                          className="h-8 w-[136px]"
                        />
                        <div
                          role="group"
                          aria-label={`${x.label} usual days`}
                          className="flex gap-0.5"
                        >
                          {DAY_LETTERS.map((letter, d) => {
                            const on = x.days.includes(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                aria-pressed={on}
                                aria-label={DAY_NAMES[d]}
                                title={DAY_NAMES[d]}
                                onClick={() =>
                                  patchShift(schedule.id, x.id, {
                                    days: on
                                      ? x.days.filter((v) => v !== d)
                                      : [...x.days, d].sort(),
                                  })
                                }
                                className={cn(
                                  "h-7 w-7 rounded-full text-[11.5px] font-bold transition-colors",
                                  on
                                    ? "bg-accent text-accent-contrast"
                                    : "bg-chip text-ink-muted hover:bg-chip-strong",
                                )}
                              >
                                {letter}
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-ink-muted ml-auto text-[12px]">
                          {formatHours(x.start, x.end)}
                          {x.days.length > 0 && ` · ${formatDays(x.days)}`}
                          {days > 0 && ` · ${days.toLocaleString()} days`}
                        </span>
                        <IconButton
                          aria-label={`Delete ${x.label}`}
                          title={days > 0 ? `Used on ${days} days` : "Delete"}
                          size="sm"
                          disabled={days > 0}
                          onClick={() =>
                            patchSchedule(schedule.id, (s) => ({
                              ...s,
                              shifts: s.shifts.filter((v) => v.id !== x.id),
                            }))
                          }
                        >
                          <TrashIcon />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => addShift(schedule)}
                >
                  <PlusIcon size={14} weight="bold" />
                  Add a shift
                </Button>
              </section>
            );
          })}
          <div>
            <Button variant="outline" size="sm" onClick={() => addSchedule()}>
              <PlusIcon size={14} weight="bold" />
              Add a schedule
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-4 flex flex-col gap-2">
          {draft.groups.map((group, index) => {
            const count = membersIn(group.id);
            return (
              <div
                key={group.id}
                className="border-line bg-card rounded-card flex flex-wrap items-center gap-2 border px-3 py-2.5"
              >
                <Input
                  aria-label="Team name"
                  value={group.name}
                  maxLength={60}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      groups: d.groups.map((g) =>
                        g.id === group.id ? { ...g, name: e.target.value } : g,
                      ),
                    }))
                  }
                  className="h-8 w-[200px] font-semibold"
                />
                <select
                  aria-label={`Schedule for ${group.name}`}
                  className={cn(SELECT_CLASS, "h-8 w-[180px]")}
                  value={group.scheduleId}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      groups: d.groups.map((g) =>
                        g.id === group.id ? { ...g, scheduleId: e.target.value } : g,
                      ),
                    }))
                  }
                >
                  {draft.schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-ink-muted text-[12.5px]">
                  {count} {count === 1 ? "person" : "people"}
                </span>
                <div className="ml-auto flex gap-0.5">
                  <IconButton
                    aria-label={`Move ${group.name} up`}
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Move ${group.name} down`}
                    size="sm"
                    disabled={index === draft.groups.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${group.name}`}
                    title={count ? "Move its people to another team first" : "Delete"}
                    size="sm"
                    disabled={count > 0}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        groups: d.groups.filter((g) => g.id !== group.id),
                      }))
                    }
                  >
                    <TrashIcon />
                  </IconButton>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  groups: [
                    ...d.groups,
                    {
                      id: uniqueId(
                        "team",
                        d.groups.map((g) => g.id),
                        newId("grp"),
                      ),
                      name: "New team",
                      scheduleId: d.schedules[0]?.id ?? "main",
                    },
                  ],
                }))
              }
            >
              <PlusIcon size={14} weight="bold" />
              Add a team
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {error && (
        <p role="alert" className="text-red mt-4 flex items-start gap-2 text-[13px]">
          <WarningCircleIcon size={16} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void submit()}>
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}
