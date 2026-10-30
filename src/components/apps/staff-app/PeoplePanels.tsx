"use client";

import { useEffect, useMemo, useState } from "react";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Button, Input } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { buildMailto } from "@/lib/pmo/chaser";
import {
  isComplete,
  makeChecklist,
  newArrivals,
  BULK_ARRIVALS,
  progressOf,
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
import { PersonName } from "@/components/people/PersonName";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { useTemplateText } from "../templates-app/useTemplateText";

/** Roll-off and contract ends in the next 30 days, birthdays and anniversaries in the next 14. */
export function PeoplePanel() {
  const employees = useStaffStore((s) => s.employees);
  const me = useMyFirstName();
  const birthdayText = useTemplateText("app:staff:birthday");
  const anniversaryText = useTemplateText("app:staff:anniversary");
  const today = todayIso();
  const alerts = endAlerts(employees, today);
  const occasions = upcomingOccasions(employees, today, 14);
  return (
    <div className="flex flex-col gap-5" data-testid="people-panel">
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

/** Who has which skills, and who can cover a skill on a day (people on approved leave are listed apart). */
export function SkillsPanel() {
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const [query, setQuery] = useState("");
  const [day, setDay] = useState(todayIso());
  const matrix = useMemo(() => skillsMatrix(employees), [employees]);
  const away = new Set(
    employees.filter((e) => leaveOn(timeOff, e.id, day)).map((e) => e.id),
  );
  const cover = whoCanCover(query, employees, away);
  return (
    <div className="flex flex-col gap-4" data-testid="skills-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Skill to cover"
          placeholder="Who can cover… (a skill)"
          className="max-w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Input
          aria-label="Day to cover"
          type="date"
          className="w-44"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
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
        <div className="scroll-thin overflow-auto">
          <table className="text-[12px]" data-testid="skills-matrix">
            <thead>
              <tr>
                <th className="text-ink-muted px-2 py-1 text-left font-semibold">
                  Person
                </th>
                {matrix.skills.map((s) => (
                  <th
                    key={s.skill}
                    className="text-ink-muted px-2 py-1 text-left font-semibold"
                  >
                    {s.skill} ({s.count})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.employee.id} className="border-line border-t">
                  <td className="text-ink px-2 py-1">
                    <PersonName name={fullName(r.employee)} employeeId={r.employee.id} />
                  </td>
                  {r.has.map((has, i) => (
                    <td key={i} className="px-2 py-1 text-center">
                      {has ? "●" : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The client managers, their teams and the people in each. */
export function OrgPanel() {
  const employees = useStaffStore((s) => s.employees);
  const chart = useMemo(() => orgChart(employees), [employees]);
  return (
    <div className="flex flex-col gap-3" data-testid="org-panel">
      {chart.map((node) => (
        <section
          key={node.manager}
          className="border-line bg-card rounded-card border px-4 py-3"
        >
          <h3 className="text-ink text-[14px] font-bold">
            {node.manager}{" "}
            <span className="text-ink-muted font-normal">({node.count})</span>
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {node.teams.map((t) => (
              <li key={t.team} className="text-[13px]">
                <span className="text-ink-soft font-semibold">{t.team}: </span>
                <span className="text-ink">{t.people.map(displayName).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {chart.length === 0 && (
        <p className="text-ink-muted text-[13px]">The directory is empty.</p>
      )}
    </div>
  );
}

/**
 * Onboarding checklists start by themselves for people who join the directory after the first look,
 * offboarding ones for people moved to the Offboarded list. Ticking is saved on this computer.
 */
export function ChecklistsPanel() {
  const employees = useStaffStore((s) => s.employees);
  const offboarded = useStaffStore((s) => s.offboarded);
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
      if (made.length > 0)
        toast({
          message: `Started ${made.length} checklist${made.length === 1 ? "" : "s"} in Staff > Checklists.`,
        });
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
