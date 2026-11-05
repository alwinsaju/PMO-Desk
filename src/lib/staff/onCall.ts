/** A fair weekend and holiday on-call rotation. Pure. */
import { addDays, inclusiveDays, isWeekend } from "./dates.ts";

export interface Candidate {
  id: string;
  name: string;
  /** Days this person cannot take (leave, a holiday of their own location, ...). */
  unavailable?: ReadonlySet<string>;
  /** Shifts already covered earlier, so a new rotation starts fair rather than from zero. */
  history?: number;
}

export interface OnCallPlan {
  /** One entry per on-call day, in date order. */
  days: { day: string; candidateId: string | null }[];
  counts: Record<string, number>;
  /** Highest count minus lowest among people who took any; 0 or 1 is as fair as it gets. */
  spread: number;
  /** Days nobody could take. */
  uncovered: string[];
}

/** Every day covered by the holidays (a multi-day holiday counts each of its days), limited to from..to. */
export function holidayDays(
  events: readonly { kind: string; date: string; endDate: string }[],
  from: string,
  to: string,
): string[] {
  const out = new Set<string>();
  for (const event of events) {
    if (event.kind !== "holiday") continue;
    const last = event.endDate < to ? event.endDate : to;
    // Bounded by the 366-day window below, so a very long event cannot stall the panel.
    let day = event.date < from ? from : event.date;
    for (let n = 0; day <= last && n < 366; n++) {
      out.add(day);
      day = addDays(day, 1);
    }
  }
  return [...out].sort();
}

/** Weekend days in the range plus any extra days (holidays). */
export function onCallDays(
  from: string,
  to: string,
  extra: readonly string[] = [],
): string[] {
  const out = new Set(extra.filter((d) => d >= from && d <= to));
  const span = Math.min(inclusiveDays(from, to), 366);
  for (let i = 0; i < span; i++) {
    const day = addDays(from, i);
    if (isWeekend(day)) out.add(day);
  }
  return [...out].sort();
}

/** Gives each day to whoever has the fewest turns so far (counting `history`), skipping the unavailable and,
 *  where it can, someone who had the day before so a weekend pair is not always the same person. */
export function planOnCall(
  days: readonly string[],
  candidates: readonly Candidate[],
): OnCallPlan {
  const counts: Record<string, number> = {};
  for (const c of candidates) counts[c.id] = c.history ?? 0;
  const base = { ...counts };
  const lastDay: Record<string, string> = {};
  const plan: OnCallPlan["days"] = [];
  const uncovered: string[] = [];
  for (const day of [...days].sort()) {
    const free = candidates.filter((c) => !c.unavailable?.has(day));
    if (free.length === 0) {
      plan.push({ day, candidateId: null });
      uncovered.push(day);
      continue;
    }
    const prev = addDays(day, -1);
    const rested = free.filter((c) => lastDay[c.id] !== prev);
    const pool = rested.length > 0 ? rested : free;
    const pick = [...pool].sort(
      (a, b) => counts[a.id] - counts[b.id] || a.name.localeCompare(b.name),
    )[0];
    counts[pick.id] += 1;
    lastDay[pick.id] = day;
    plan.push({ day, candidateId: pick.id });
  }
  const taken = candidates.map((c) => counts[c.id] - base[c.id]).filter((n) => n > 0);
  const totals = candidates.map((c) => counts[c.id]);
  const spread = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
  void taken;
  return { days: plan, counts, spread, uncovered };
}
