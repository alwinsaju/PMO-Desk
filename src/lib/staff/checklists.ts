/** Onboarding and offboarding checklists for people entering or leaving the directory. Pure. */
import type { Employee } from "./types.ts";

export type ChecklistKind = "onboarding" | "offboarding";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Checklist {
  id: string;
  employeeId: string;
  name: string;
  kind: ChecklistKind;
  items: ChecklistItem[];
  createdAt: string;
}

export const ONBOARDING_ITEMS = [
  "Check the M365 profile has filled in (level, city, phone)",
  "Add to the shift roster and the right team",
  "Add to the team's mailing lists and Teams channels",
  "Confirm access to the client systems",
  "Introduce to the client manager and the team",
  "Book a check-in for the end of week one",
] as const;

export const OFFBOARDING_ITEMS = [
  "Hand over open to-dos and tasks",
  "Remove from the team's mailing lists and Teams channels",
  "Remove access to the client systems",
  "Collect equipment and passes",
  "Clear future shifts and leave from the roster",
  "Tell the client manager and the team",
] as const;

export function makeChecklist(
  kind: ChecklistKind,
  employee: Pick<Employee, "id" | "firstName" | "lastName">,
  now: string,
  newId: () => string,
): Checklist {
  const source = kind === "onboarding" ? ONBOARDING_ITEMS : OFFBOARDING_ITEMS;
  return {
    id: newId(),
    employeeId: employee.id,
    name: `${employee.firstName} ${employee.lastName}`.trim() || "New person",
    kind,
    items: source.map((text, i) => ({ id: `i${i}`, text, done: false })),
    createdAt: now,
  };
}

export function toggleItem(list: Checklist, itemId: string): Checklist {
  return {
    ...list,
    items: list.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
  };
}

export function progressOf(list: Checklist): { done: number; total: number } {
  return { done: list.items.filter((i) => i.done).length, total: list.items.length };
}

export const isComplete = (list: Checklist): boolean => {
  const p = progressOf(list);
  return p.total > 0 && p.done === p.total;
};

/** More people than this appearing at once is a roster import or a first load, not new hires. */
export const BULK_ARRIVALS = 10;

/** People in the directory that were not there the last time the app looked. The very first look
 *  (nothing seen yet) only records everyone and starts no checklists, and neither does a bulk
 *  addition (an Excel import): those people are recorded as seen without a checklist each. */
export function newArrivals(
  seen: readonly string[],
  employees: readonly Employee[],
): { arrivals: Employee[]; seen: string[] } {
  const ids = employees.map((e) => e.id);
  if (seen.length === 0) return { arrivals: [], seen: ids };
  const known = new Set(seen);
  const arrivals = employees.filter((e) => !known.has(e.id));
  return {
    arrivals: arrivals.length > BULK_ARRIVALS ? [] : arrivals,
    seen: [...new Set([...seen, ...ids])],
  };
}

export function sanitizeChecklists(value: unknown): Checklist[] {
  if (!Array.isArray(value)) return [];
  const out: Checklist[] = [];
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.employeeId !== "string" ||
      (r.kind !== "onboarding" && r.kind !== "offboarding") ||
      !Array.isArray(r.items)
    )
      continue;
    const items: ChecklistItem[] = [];
    for (const it of r.items.slice(0, 30)) {
      if (!it || typeof it !== "object") continue;
      const i = it as Record<string, unknown>;
      if (typeof i.id === "string" && typeof i.text === "string")
        items.push({
          id: i.id.slice(0, 20),
          text: i.text.slice(0, 200),
          done: i.done === true,
        });
    }
    out.push({
      id: r.id.slice(0, 40),
      employeeId: r.employeeId.slice(0, 40),
      name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
      kind: r.kind,
      items,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    });
  }
  return out;
}
