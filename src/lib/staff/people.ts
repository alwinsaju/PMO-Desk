/** People insights from the directory: end-of-contract alerts, birthdays and anniversaries, skills and an org chart. Pure. */
import { daysBetween, formatDayMonth, isIsoDate, todayIso } from "./dates.ts";
import type { Employee } from "./types.ts";

export const fullName = (e: Pick<Employee, "firstName" | "lastName">): string =>
  `${e.firstName} ${e.lastName}`.trim();

// --- roll-off and contract-end alerts --------------------------------------------------------

export type EndKind = "roll-off" | "contract end" | "staffing end";

export interface EndAlert {
  employee: Employee;
  kind: EndKind;
  date: string;
  daysLeft: number;
  /** The tightest threshold crossed: 7, 14 or 30 days. */
  band: 7 | 14 | 30;
}

const bandOf = (days: number): 7 | 14 | 30 | null =>
  days <= 7 ? 7 : days <= 14 ? 14 : days <= 30 ? 30 : null;

/** Dates that end within 30 days (and have not passed), soonest first. */
export function endAlerts(
  employees: readonly Employee[],
  today: string = todayIso(),
): EndAlert[] {
  const out: EndAlert[] = [];
  for (const employee of employees) {
    for (const [kind, date] of [
      ["roll-off", employee.rollOffDate],
      ["contract end", employee.contractEndDate],
      ["staffing end", employee.staffitEndDate],
    ] as const) {
      if (!date || !isIsoDate(date)) continue;
      const daysLeft = daysBetween(today, date);
      const band = daysLeft >= 0 ? bandOf(daysLeft) : null;
      if (band) out.push({ employee, kind, date, daysLeft, band });
    }
  }
  return out.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft || fullName(a.employee).localeCompare(fullName(b.employee)),
  );
}

export function endAlertText(a: EndAlert): string {
  const when =
    a.daysLeft === 0 ? "today" : a.daysLeft === 1 ? "tomorrow" : `in ${a.daysLeft} days`;
  return `${fullName(a.employee)}: ${a.kind} ${when} (${a.date})`;
}

// --- birthdays and anniversaries --------------------------------------------------------------

export interface Occasion {
  employee: Employee;
  kind: "birthday" | "anniversary";
  /** The next day it falls on, yyyy-mm-dd. */
  date: string;
  daysAway: number;
  /** Whole years for an anniversary (the staffing start date); 0 for a birthday. */
  years: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "MM-DD" or "yyyy-MM-dd" -> [month, day], or null. */
export function monthDay(text: string): [number, number] | null {
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [mo, d] : null;
}

/** "14 Mar" for a stored birthday ("03-14"); "" when there is none or it is unreadable. */
export function birthdayLabel(text: string): string {
  const parts = monthDay(text);
  return parts ? formatDayMonth(`2000-${pad(parts[0])}-${pad(parts[1])}`) : "";
}

function nextOccurrence(mo: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1, year + 2, year + 4]) {
    // A 29 Feb birthday falls on the next leap year; others on the next year.
    const dim = new Date(y, mo, 0).getDate();
    if (d > dim) continue;
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    if (iso >= today) return iso;
  }
  return null;
}

export function upcomingOccasions(
  employees: readonly Employee[],
  today: string = todayIso(),
  withinDays = 14,
): Occasion[] {
  const out: Occasion[] = [];
  for (const employee of employees) {
    const b = monthDay(employee.birthday ?? "");
    if (b) {
      const date = nextOccurrence(b[0], b[1], today);
      if (date && daysBetween(today, date) <= withinDays)
        out.push({
          employee,
          kind: "birthday",
          date,
          daysAway: daysBetween(today, date),
          years: 0,
        });
    }
    const start = employee.staffitStartDate;
    if (start && isIsoDate(start)) {
      const mo = Number(start.slice(5, 7));
      const d = Number(start.slice(8, 10));
      const date = nextOccurrence(mo, d, today);
      const years = date ? Number(date.slice(0, 4)) - Number(start.slice(0, 4)) : 0;
      if (date && years >= 1 && daysBetween(today, date) <= withinDays)
        out.push({
          employee,
          kind: "anniversary",
          date,
          daysAway: daysBetween(today, date),
          years,
        });
    }
  }
  return out.sort(
    (a, b) =>
      a.daysAway - b.daysAway || fullName(a.employee).localeCompare(fullName(b.employee)),
  );
}

export function greetingDraft(
  o: Occasion,
  from: string,
): { subject: string; body: string } {
  const first = o.employee.firstName || "there";
  return o.kind === "birthday"
    ? {
        subject: `Happy birthday, ${first}!`,
        body: `Hi ${first},\n\nHappy birthday! Hope you have a great day.\n\n${from}`,
      }
    : {
        subject: `Congratulations on ${o.years} year${o.years === 1 ? "" : "s"}, ${first}!`,
        body: `Hi ${first},\n\nCongratulations on ${o.years} year${o.years === 1 ? "" : "s"} on the team. Thank you for everything you do.\n\n${from}`,
      };
}

// --- skills -----------------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();

export interface SkillsMatrix {
  /** Most common first. */
  skills: { skill: string; count: number }[];
  /** Each person with the skills (by `skills[i].skill` order) they have. */
  rows: { employee: Employee; has: boolean[] }[];
}

export function skillsMatrix(
  employees: readonly Employee[],
  maxSkills = 24,
): SkillsMatrix {
  const counts = new Map<string, { skill: string; count: number }>();
  for (const e of employees)
    for (const s of new Set(e.skills.map(norm).filter(Boolean))) {
      const label = e.skills.find((x) => norm(x) === s) ?? s;
      const cur = counts.get(s);
      if (cur) cur.count += 1;
      else counts.set(s, { skill: label.trim(), count: 1 });
    }
  const skills = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, maxSkills);
  const rows = employees
    .map((employee) => {
      const mine = new Set(employee.skills.map(norm));
      return { employee, has: skills.map((s) => mine.has(norm(s.skill))) };
    })
    .filter((r) => r.has.some(Boolean))
    .sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)));
  return { skills, rows };
}

export interface Cover {
  available: Employee[];
  away: Employee[];
}

/** Everyone with the skill (a partial match counts), split by whether they are away on the day. */
export function whoCanCover(
  skill: string,
  employees: readonly Employee[],
  awayIds: ReadonlySet<string>,
): Cover {
  const q = norm(skill);
  if (!q) return { available: [], away: [] };
  const has = employees.filter((e) => e.skills.some((s) => norm(s).includes(q)));
  const byName = (a: Employee, b: Employee) => fullName(a).localeCompare(fullName(b));
  return {
    available: has.filter((e) => !awayIds.has(e.id)).sort(byName),
    away: has.filter((e) => awayIds.has(e.id)).sort(byName),
  };
}

// --- org chart --------------------------------------------------------------------------------

export interface OrgNode {
  /** The client manager's name, or "No client manager" when none is set. */
  manager: string;
  /** No client manager is set for these people. */
  unassigned: boolean;
  teams: { team: string; people: Employee[] }[];
  count: number;
}

const NO_MANAGER = "No client manager";
const NO_TEAM = "No team";

export function orgChart(employees: readonly Employee[]): OrgNode[] {
  const byManager = new Map<string, Map<string, Employee[]>>();
  for (const e of employees) {
    const manager = e.clientManager.trim() || NO_MANAGER;
    const team = e.team.trim() || NO_TEAM;
    const teams = byManager.get(manager) ?? new Map<string, Employee[]>();
    teams.set(team, [...(teams.get(team) ?? []), e]);
    byManager.set(manager, teams);
  }
  const lastIf = (a: boolean, b: boolean) => Number(a) - Number(b);
  return [...byManager]
    .map(([manager, teams]) => ({
      manager,
      unassigned: manager === NO_MANAGER,
      teams: [...teams]
        .map(([team, people]) => ({
          team,
          people: [...people].sort((a, b) => fullName(a).localeCompare(fullName(b))),
        }))
        .sort(
          (a, b) =>
            lastIf(a.team === NO_TEAM, b.team === NO_TEAM) ||
            a.team.localeCompare(b.team),
        ),
      count: [...teams.values()].reduce((n, p) => n + p.length, 0),
    }))
    .sort(
      (a, b) =>
        lastIf(a.unassigned, b.unassigned) ||
        b.count - a.count ||
        a.manager.localeCompare(b.manager),
    );
}
