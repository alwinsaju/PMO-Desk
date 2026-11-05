"use client";

import { useEffect, useMemo, useState } from "react";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import { buildMailto } from "@/lib/pmo/chaser";
import {
  isComplete,
  makeChecklist,
  newArrivals,
  BULK_ARRIVALS,
  progressOf,
  startedText,
  toggleItem,
  type Checklist,
} from "@/lib/staff/checklists";
import { todayIso } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import { leaveOn, newId } from "@/lib/staff/shifts";
import {
  endAlerts,
  endAlertText,
  fullName,
  greetingDraft,
  orgChart,
  skillsMatrix,
  upcomingOccasions,
  whoCanCover,
} from "@/lib/staff/people";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { useActiveStaff } from "./tabActive";
import type { Employee } from "@/lib/staff/types";
import { PersonName } from "@/components/people/PersonName";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { useTemplateText } from "../templates-app/useTemplateText";
import { EmployeeAvatar, PersonAvatar } from "./parts";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { DateField } from "./DateField";
import { BarChartCard, DonutCard } from "./DistributionCharts";
import { distribution, tagWeight } from "@/lib/staff/insightsData";

/** Roll-off and contract ends in the next 30 days, birthdays and anniversaries in the next 14. */
export function PeoplePanel() {
  const employees = useActiveStaff((s) => s.employees);
  const me = useMyFirstName();
  const birthdayText = useTemplateText("app:staff:birthday");
  const anniversaryText = useTemplateText("app:staff:anniversary");
  const today = todayIso();
  const alerts = endAlerts(employees, today);
  const occasions = upcomingOccasions(employees, today, 14);
  const byLocation = useMemo(() => distribution(employees, "location"), [employees]);
  const byLevel = useMemo(() => distribution(employees, "level", 8), [employees]);
  const byTeam = useMemo(() => distribution(employees, "team", 8), [employees]);
  return (
    <div className="@container flex flex-col gap-5" data-testid="people-panel">
      {employees.length > 0 && (
        <section
          aria-label="Distribution"
          className="grid items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3"
          data-testid="distributions"
        >
          <DonutCard title="By location" slices={byLocation} total={employees.length} />
          <BarChartCard title="By level" slices={byLevel} />
          <BarChartCard title="By team" slices={byTeam} />
        </section>
      )}
      <section aria-label="Ending soon" className="flex flex-col gap-1.5">
        <h3 className="text-ink text-[14px] font-bold">Ending in the next 30 days</h3>
        {alerts.length === 0 ? (
          <p className="text-ink-muted text-[13px]">
            No roll-off or contract end is close.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="end-alerts">
            {alerts.map((a) => (
              <li
                key={`${a.employee.id}-${a.kind}`}
                className={`text-[13px] ${a.band === 7 ? "text-red font-semibold" : a.band === 14 ? "text-amber font-medium" : "text-ink-soft"}`}
              >
                {endAlertText(a)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Birthdays and anniversaries" className="flex flex-col gap-1.5">
        <h3 className="text-ink text-[14px] font-bold">Birthdays and anniversaries</h3>
        {occasions.length === 0 ? (
          <p className="text-ink-muted text-[13px]">
            Nothing in the next two weeks. Add birthdays in a person&apos;s profile;
            anniversaries use the staffing start date.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="occasions">
            {occasions.map((o) => {
              const builtIn = greetingDraft(o, me);
              const text = o.kind === "birthday" ? birthdayText : anniversaryText;
              const draft = text.fill(
                {
                  first_name: o.employee.firstName || "there",
                  years: String(o.years),
                  my_name: me,
                },
                builtIn,
              );
              const mail = buildMailto({
                to: o.employee.deloitteEmail,
                subject: draft.subject,
                body: draft.body,
              });
              return (
                <li
                  key={`${o.employee.id}-${o.kind}`}
                  className="flex items-center gap-3 text-[13px]"
                >
                  <span className="text-ink min-w-0 flex-1">
                    {fullName(o.employee)}:{" "}
                    {o.kind === "birthday" ? "birthday" : `${o.years}-year anniversary`}{" "}
                    {o.daysAway === 0
                      ? "today"
                      : o.daysAway === 1
                        ? "tomorrow"
                        : `in ${o.daysAway} days`}
                  </span>
                  {mail.ok && (
                    <Button size="sm" variant="ghost" asChild>
                      <a
                        href={mail.url}
                        onClick={() =>
                          (o.kind === "birthday" ? birthdayText : anniversaryText).used()
                        }
                      >
                        <EnvelopeSimpleIcon size={13} />
                        Draft greeting
                      </a>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const SKILL_WEIGHT = {
  1: "bg-chip text-ink-soft text-[11.5px]",
  2: "bg-chip-strong text-ink text-[12.5px]",
  3: "bg-accent-soft text-accent-ink text-[13.5px]",
  4: "bg-accent-soft text-accent-ink text-[15px]",
} as const;

/** Who has which skills, and who can cover a skill on a day (people on approved leave are listed apart). */
export function SkillsPanel() {
  const employees = useActiveStaff((s) => s.employees);
  const timeOff = useActiveStaff((s) => s.timeOff);
  const [query, setQuery] = useState("");
  const [day, setDay] = useState(todayIso());
  const matrix = useMemo(() => skillsMatrix(employees), [employees]);
  const counts = matrix.skills.map((s) => s.count);
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  const away = new Set(
    employees.filter((e) => leaveOn(timeOff, e.id, day)).map((e) => e.id),
  );
  const cover = whoCanCover(query, employees, away);
  return (
    <div className="flex flex-col gap-4" data-testid="skills-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          {...noSpellcheck}
          aria-label="Skill to cover"
          placeholder="Who can cover… (a skill)"
          className="max-w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <DateField label="Day to cover" value={day} onChange={setDay} />
      </div>
      {query.trim() && (
        <div className="text-[13px]" data-testid="cover-result">
          <p className="text-ink">
            Available: {cover.available.map(fullName).join(", ") || "nobody"}
          </p>
          {cover.away.length > 0 && (
            <p className="text-ink-muted">
              On leave: {cover.away.map(fullName).join(", ")}
            </p>
          )}
        </div>
      )}
      {matrix.rows.length === 0 ? (
        <p className="text-ink-muted text-[13px]">
          No skills are recorded yet. Add them in a person&apos;s profile.
        </p>
      ) : (
        <>
          <ul
            aria-label="Skills by how many people have them"
            className="flex flex-wrap items-baseline gap-2"
            data-testid="skill-cloud"
          >
            {matrix.skills.map((s) => (
              <li key={s.skill}>
                <button
                  type="button"
                  aria-pressed={query.trim().toLowerCase() === s.skill.toLowerCase()}
                  title={`Who can cover ${s.skill}`}
                  onClick={() =>
                    setQuery(
                      query.trim().toLowerCase() === s.skill.toLowerCase() ? "" : s.skill,
                    )
                  }
                  className={cn(
                    "rounded-chip focus-ring px-2.5 py-1 font-semibold transition-colors",
                    SKILL_WEIGHT[tagWeight(s.count, minCount, maxCount)],
                    "aria-pressed:bg-accent aria-pressed:text-accent-contrast",
                  )}
                >
                  {s.skill}
                  <span className="ml-1.5 text-[11px] opacity-70">{s.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-line bg-card rounded-card scroll-thin max-h-[60vh] overflow-auto border">
            <table
              className="border-separate border-spacing-0 text-[12px]"
              data-testid="skills-matrix"
            >
              <thead>
                <tr>
                  <th className="text-ink-muted bg-card border-line sticky top-0 left-0 z-[2] border-b px-3 py-2 text-left font-semibold">
                    Person
                  </th>
                  {matrix.skills.map((s) => (
                    <th
                      key={s.skill}
                      scope="col"
                      title={`${s.skill}: ${s.count}`}
                      className="text-ink-muted bg-card border-line sticky top-0 z-[1] h-[110px] border-b px-1 align-bottom font-semibold"
                    >
                      <span className="inline-block max-h-[100px] rotate-180 truncate [writing-mode:vertical-rl]">
                        {s.skill} ({s.count})
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.employee.id} className="hover:bg-chip/60">
                    <th
                      scope="row"
                      className="text-ink bg-card border-line sticky left-0 z-[1] border-b px-3 py-1.5 text-left font-normal whitespace-nowrap"
                    >
                      <PersonName
                        name={fullName(r.employee)}
                        employeeId={r.employee.id}
                      />
                    </th>
                    {r.has.map((has, i) => (
                      <td
                        key={i}
                        className="border-line border-b px-1 py-1.5 text-center"
                      >
                        {has ? (
                          <>
                            <span
                              aria-hidden
                              className="bg-accent inline-block h-3 w-3 rounded-full"
                            />
                            <span className="sr-only">Has {matrix.skills[i].skill}</span>
                          </>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** The client managers, their teams and the people in each, as a tree. */
export function OrgPanel() {
  const employees = useActiveStaff((s) => s.employees);
  const chart = useMemo(() => orgChart(employees), [employees]);
  if (chart.length === 0) {
    return <p className="text-ink-muted text-[13px]">The directory is empty.</p>;
  }
  // No client managers set at all: just the teams, with no manager level above them.
  const flat = chart.length === 1 && chart[0].unassigned;
  return (
    <div className="flex flex-col gap-3" data-testid="org-panel">
      {flat ? (
        <ul className="grid gap-3 @2xl:grid-cols-2">
          {chart[0].teams.map((t) => (
            <li key={t.team} className="border-line bg-card rounded-card border p-4">
              <TeamBranch team={t.team} people={t.people} />
            </li>
          ))}
        </ul>
      ) : (
        chart.map((node) => {
          const manager = node.unassigned
            ? null
            : employees.find(
                (e) => fullName(e).toLowerCase() === node.manager.toLowerCase(),
              );
          return (
            <section
              key={node.manager}
              className="border-line bg-card rounded-card border p-4"
              aria-label={node.unassigned ? "Other teams" : `${node.manager}'s teams`}
            >
              <h3 className="flex items-center gap-2.5">
                {!node.unassigned && (
                  <PersonAvatar
                    employee={manager ?? null}
                    name={node.manager}
                    size="md"
                  />
                )}
                <span className="text-ink text-[14.5px] font-bold">
                  {node.unassigned ? "Other teams" : node.manager}
                </span>
                <span className="text-ink-muted text-[12.5px] font-normal">
                  {node.count} {node.count === 1 ? "person" : "people"} ·{" "}
                  {node.teams.length} {node.teams.length === 1 ? "team" : "teams"}
                </span>
              </h3>
              <ul className="border-line mt-3 ml-4 flex flex-col gap-4 border-l pl-5">
                {node.teams.map((t) => (
                  <li key={t.team}>
                    <TeamBranch team={t.team} people={t.people} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function TeamBranch({ team, people }: { team: string; people: Employee[] }) {
  return (
    <>
      <h4 className="text-ink-soft mb-2 flex items-center gap-2 text-[13px] font-bold">
        {team}
        <span className="bg-chip text-ink-soft rounded-chip px-2 py-0.5 text-[11.5px] font-semibold">
          {people.length}
        </span>
      </h4>
      <ul
        className="grid gap-x-3 gap-y-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
      >
        {people.map((p) => (
          <li key={p.id} className="flex min-w-0 items-center gap-2.5">
            <EmployeeAvatar employee={p} size="sm" />
            <span className="min-w-0">
              <span className="text-ink block truncate text-[13px] font-semibold">
                {displayName(p)}
              </span>
              {p.level && (
                <span className="text-ink-muted block truncate text-[11.5px]">
                  {p.level}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Onboarding checklists start by themselves for people who join the directory after the first look,
 * offboarding ones for people moved to the Offboarded list. Ticking is saved on this computer.
 */
export function ChecklistsPanel() {
  // Only people the server has saved start a checklist: an add that fails leaves none behind.
  const employees = useStaffStore((s) => s.savedEmployees);
  const offboarded = useStaffStore((s) => s.savedOffboarded);
  const status = useStaffStore((s) => s.status);
  const lists = useStaffPrefs((s) => s.checklists);
  const update = useStaffPrefs((s) => s.update);
  const [hydrated, setHydrated] = useState(() => useStaffPrefs.persist.hasHydrated());
  useEffect(() => useStaffPrefs.persist.onFinishHydration(() => setHydrated(true)), []);

  useEffect(() => {
    if (status !== "ready" || !hydrated) return;
    const { arrivals, seen } = newArrivals(
      useStaffPrefs.getState().seenEmployees,
      employees,
    );
    const known = new Set(
      useStaffPrefs.getState().checklists.map((c) => `${c.kind}:${c.employeeId}`),
    );
    const now = new Date().toISOString();
    const made: Checklist[] = arrivals
      .filter((e) => !known.has(`onboarding:${e.id}`))
      .map((e) => makeChecklist("onboarding", e, now, () => newId("cl")));
    // Offboarding starts for anyone newly on the Offboarded list, once the first look has been taken
    // (a bulk move of more than BULK_ARRIVALS people at once gets none).
    const first = useStaffPrefs.getState().seenEmployees.length === 0;
    if (!first) {
      const fresh = offboarded.filter((o) => !known.has(`offboarding:${o.id}`));
      if (fresh.length <= BULK_ARRIVALS) {
        for (const o of fresh)
          made.push(makeChecklist("offboarding", o, now, () => newId("cl")));
      }
    }
    if (
      made.length > 0 ||
      seen.length !== useStaffPrefs.getState().seenEmployees.length
    ) {
      update((p) => ({
        ...p,
        seenEmployees: seen,
        checklists: [...p.checklists, ...made],
      }));
      if (made.length > 0) toast({ ...startedText(made), tone: "info" });
    }
  }, [status, hydrated, employees, offboarded, update]);

  const open = lists.filter((l) => !isComplete(l));
  const done = lists.filter(isComplete);
  const render = (list: Checklist) => {
    const p = progressOf(list);
    return (
      <section
        key={list.id}
        data-testid="checklist"
        className="border-line bg-card rounded-card flex flex-col gap-1.5 border px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-ink text-[13.5px] font-bold">
            {list.kind === "onboarding" ? "Onboarding" : "Offboarding"}: {list.name}
          </h3>
          <span className="text-ink-muted text-[12px]">
            {p.done}/{p.total}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {list.items.map((item) => (
            <li key={item.id}>
              <label className="text-ink-soft flex items-start gap-2.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    update((s) => ({
                      ...s,
                      checklists: s.checklists.map((c) =>
                        c.id === list.id ? toggleItem(c, item.id) : c,
                      ),
                    }))
                  }
                  className="accent-accent mt-0.5 h-4 w-4"
                />
                <span className={item.done ? "line-through opacity-60" : ""}>
                  {item.text}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="checklists-panel">
      {lists.length === 0 && (
        <p className="text-ink-muted text-[13px]">
          No checklists yet. One starts when someone is added to the directory or moved to
          the Offboarded list.
        </p>
      )}
      {open.map(render)}
      {done.length > 0 && (
        <details>
          <summary className="text-ink-muted cursor-pointer text-[12.5px]">
            {done.length} completed
          </summary>
          <div className="mt-2 flex flex-col gap-3">{done.map(render)}</div>
        </details>
      )}
    </div>
  );
}
