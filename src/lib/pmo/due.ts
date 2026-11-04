// The reminder engine: which to-dos need a notification right now. Pure (no
// clock, no files, no node imports), so the server, the UI and `pnpm test` all
// use the same rules, and every test runs against a fake `now`.
//
// What the rules mean (the full write-up is ARCHITECTURE.md, "Reminders"):
//  - Everything is judged in `prefs.timeZone` (IST by default; IST has no DST,
//    but the maths is generic).
//  - due-soon   once per due date, from `leadWorkingDays` working days before it
//               (default 1: a Monday-due item is reminded on the Friday) until
//               the due day, when the overdue reminder takes over at 09:00.
//               0 turns the advance reminder off.
//  - overdue    09:00 (work start) on the due day, then once per working day.
//  - chaser     a to-do with "waiting on" set and no reply for N working days
//               (counted from `waitingSince`, else the last update; N is the
//               to-do's own `chaserDays`, else the global default); repeats
//               every N working days after that.
//  - digest     optional, one summary of the open items per working day.
//  - quiet hours: with `quietOutsideHours` nothing is produced outside the
//               working window; the same notification simply becomes due when
//               the window opens (it has not been delivered yet, so it fires).
//  - snooze: `reminders.snoozedUntil` silences one to-do until that instant.
// Dedupe is by `key`: the server records delivered keys in state/notify.json.
import { approverName, awaitingSignoff } from "./signoff.ts";
import { isRealIsoDay, safeTimeZone } from "./time.ts";
import type { ReminderPrefs, Todo } from "./types.ts";

export type DueKind = "due-soon" | "overdue" | "chaser" | "digest";

export interface DueNotification {
  /** null for the digest. */
  todoId: string | null;
  kind: DueKind;
  /** Stable dedupe key: the same reminder always has the same key. */
  key: string;
  title: string;
  body: string;
  /** Digest only: how many open items it summarises. */
  count?: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Time zone helpers (Intl only)
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(configured: string): Intl.DateTimeFormat {
  // A hand-edited bad zone name must never throw out of the engine.
  const timeZone = safeTimeZone(configured);
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalParts {
  /** YYYY-MM-DD in the zone. */
  day: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
  /** The wall-clock reading as if it were UTC, in ms (for offset maths). */
  wallMs: number;
}

export function localParts(
  instant: Date | string | number,
  timeZone: string,
): LocalParts {
  const date = new Date(instant);
  const bag: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date))
    bag[part.type] = part.value;
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  return {
    day: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAY_INDEX[bag.weekday] ?? 0,
    wallMs: Date.UTC(
      Number(bag.year),
      Number(bag.month) - 1,
      Number(bag.day),
      hour,
      minute,
      Number(bag.second),
    ),
  };
}

/** The UTC instant at which the clock in `timeZone` reads `day` `hhmm`. */
export function zonedInstant(day: string, hhmm: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const offsetAt = (ts: number) => localParts(ts, timeZone).wallMs - (ts - (ts % 1000));
  // Two passes settle the offset even when it changes (DST) near `wall`.
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess);
}

/** YYYY-MM-DD moved by `offset` calendar days (month/year rollover exact). */
export function addDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

const weekdayOf = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
};

/** The first Monday after `day` (a Monday gives the one a week later). */
export const nextMondayAfter = (day: string): string =>
  addDays(day, (8 - weekdayOf(day)) % 7 || 7);

export const isWorkingDay = (day: string, prefs: Pick<ReminderPrefs, "workDays">) =>
  prefs.workDays.includes(weekdayOf(day));

/** Working days in the half-open range (from, to]: 0 when `to` is not later. */
export function workingDaysBetween(
  from: string,
  to: string,
  prefs: Pick<ReminderPrefs, "workDays">,
): number {
  let count = 0;
  let day = from;
  for (let guard = 0; day < to && guard < 800; guard++) {
    day = addDays(day, 1);
    if (isWorkingDay(day, prefs)) count++;
  }
  return count;
}

/** The working day on which the advance reminder for `dueAt` is first due:
 *  `lead` working days before it (a Monday with lead 1 gives the Friday before).
 *  null when the lead is 0: no advance reminder, the due day itself notifies. */
export function advanceReminderDay(
  dueAt: string,
  prefs: Pick<ReminderPrefs, "workDays" | "leadWorkingDays">,
): string | null {
  let remaining = prefs.leadWorkingDays;
  if (remaining <= 0) return null;
  let day = dueAt;
  for (let guard = 0; remaining > 0 && guard < 60; guard++) {
    day = addDays(day, -1);
    if (isWorkingDay(day, prefs)) remaining--;
  }
  return day;
}

const clockMinutes = (hhmm: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
};

const calendarDaysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T00:00:00Z`));

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

export const isSnoozed = (todo: Pick<Todo, "reminders">, now: Date): boolean => {
  const until = todo.reminders.snoozedUntil;
  return until !== null && Date.parse(until) > now.getTime();
};

export type SnoozeChoice = "1h" | "after-lunch" | "tomorrow" | "3d" | "monday";

/** "After lunch" is 14:00 in the zone; once that has passed today it is tomorrow's start of day. */
export const AFTER_LUNCH = "14:00";

/** When a quick-snooze button wakes the to-do up. "Tomorrow", "3 days" and "Monday"
 *  are at the start of the working day (09:00 by default) in the prefs' zone;
 *  "3 days" is three calendar days after today (like "tomorrow", it does not skip
 *  weekends); "Monday" is the next Monday after today (a Monday snoozes a full week). */
export function snoozeUntil(
  choice: SnoozeChoice,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workStart">,
): Date {
  if (choice === "1h") return new Date(now.getTime() + HOUR_MS);
  const today = localParts(now, prefs.timeZone).day;
  if (choice === "after-lunch") {
    const lunch = zonedInstant(today, AFTER_LUNCH, prefs.timeZone);
    return lunch.getTime() > now.getTime()
      ? lunch
      : zonedInstant(addDays(today, 1), prefs.workStart, prefs.timeZone);
  }
  const day =
    choice === "tomorrow"
      ? addDays(today, 1)
      : choice === "3d"
        ? addDays(today, 3)
        : nextMondayAfter(today);
  return zonedInstant(day, prefs.workStart, prefs.timeZone);
}

/** A `datetime-local` value ("2026-10-26T09:30") read in the prefs' zone. */
export function instantFromLocalInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match || !isRealIsoDay(match[1])) return null; // 2026-02-30 is not a day
  const instant = zonedInstant(match[1], match[2], timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** "Mon 26 Oct, 09:00" for an instant in the zone. */
export function describeInstant(instant: Date | string, timeZone: string): string {
  const date = new Date(instant);
  const parts = localParts(date, timeZone);
  const hh = String(Math.floor(parts.minutes / 60)).padStart(2, "0");
  const mm = String(parts.minutes % 60).padStart(2, "0");
  return `${shortDay(parts.day)}, ${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Chasers: how long has a to-do been waiting, and is it time to chase?
// ---------------------------------------------------------------------------

/** When the chaser clock started: when "waiting on" was set, else (a to-do from
 *  before phase 4) the last update. null if neither is a readable date. */
export function chaserClockStart(
  todo: Pick<Todo, "waitingSince" | "updatedAt">,
): string | null {
  const start = todo.waitingSince ?? todo.updatedAt;
  return Number.isNaN(Date.parse(start)) ? null : start;
}

/** This to-do's own cadence, else the global one. */
export const chaserDaysFor = (
  todo: Pick<Todo, "chaserDays">,
  prefs: Pick<ReminderPrefs, "chaserDays">,
): number => todo.chaserDays ?? prefs.chaserDays;

export interface WaitingState {
  /** Working days with no reply so far. */
  quietDays: number;
  /** Calendar days since the waiting began. */
  calendarDays: number;
  /** The cadence in force. */
  everyDays: number;
  /** quietDays has reached the cadence: a chaser is due. */
  chaseDue: boolean;
  /** Which repeat this is (1 = first chaser, 2 = after another N days, ...). */
  round: number;
  /** IST day (in the prefs' zone) the clock started. */
  sinceDay: string;
}

/** null when the to-do is not waiting on anyone. */
export function waitingState(
  todo: Pick<Todo, "waitingOn" | "waitingSince" | "updatedAt" | "chaserDays" | "status">,
  now: Date,
  prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">,
): WaitingState | null {
  if (todo.status !== "open" || !todo.waitingOn?.trim()) return null;
  const start = chaserClockStart(todo);
  if (!start) return null;
  const sinceDay = localParts(start, prefs.timeZone).day;
  const today = localParts(now, prefs.timeZone).day;
  const quietDays = workingDaysBetween(sinceDay, today, prefs);
  const everyDays = chaserDaysFor(todo, prefs);
  return {
    quietDays,
    calendarDays: Math.max(0, calendarDaysBetween(sinceDay, today)),
    everyDays,
    chaseDue: quietDays >= everyDays,
    round: Math.floor(quietDays / everyDays),
    sinceDay,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const KIND_RANK: Record<DueKind, number> = {
  overdue: 0,
  chaser: 1,
  "due-soon": 2,
  digest: 3,
};

/** Everything that should be notified at `now`, minus nothing: dedupe against
 *  what was already delivered is the caller's job (it owns the state). */
export function computeDue(
  todos: readonly Todo[],
  now: Date,
  prefs: ReminderPrefs,
): DueNotification[] {
  if (!prefs.enabled) return [];

  const zone = prefs.timeZone;
  const local = localParts(now, zone);
  const today = local.day;
  const start = clockMinutes(prefs.workStart);
  const end = clockMinutes(prefs.workEnd);
  const workingToday = isWorkingDay(today, prefs);
  const afterStart = local.minutes >= start;
  const inWindow = workingToday && afterStart && local.minutes < end;
  // The day-bound kinds (overdue, chaser, digest) never fire before the day's
  // start, or on a day off; quiet hours also stop them at the end of the day.
  const dayKindsOpen = prefs.quietOutsideHours ? inWindow : workingToday && afterStart;
  const dueSoonOpen = prefs.quietOutsideHours ? inWindow : true;

  const open = todos.filter((todo) => todo.status === "open");
  const out: DueNotification[] = [];

  for (const todo of open) {
    if (isSnoozed(todo, now)) continue;

    if (todo.dueAt) {
      // Not yet due, and past the start of the reminder day: a reminder held
      // back by quiet hours stays eligible until the due day takes over.
      const reminderDay = advanceReminderDay(todo.dueAt, prefs);
      const advanceOpen =
        reminderDay !== null &&
        today < todo.dueAt &&
        now.getTime() > zonedInstant(reminderDay, "00:00", zone).getTime();
      if (dueSoonOpen && advanceOpen) {
        out.push({
          todoId: todo.id,
          kind: "due-soon",
          key: `due-soon:${todo.id}:${todo.dueAt}`,
          title: todo.title,
          body:
            calendarDaysBetween(today, todo.dueAt) === 1
              ? `Due tomorrow (${shortDay(todo.dueAt)}).`
              : `Due ${shortDay(todo.dueAt)}.`,
        });
      } else if (dayKindsOpen && todo.dueAt <= today) {
        const late = calendarDaysBetween(todo.dueAt, today);
        out.push({
          todoId: todo.id,
          kind: "overdue",
          key: `overdue:${todo.id}:${todo.dueAt}:${today}`,
          title: todo.title,
          body:
            late === 0
              ? "Due today."
              : `Overdue by ${plural(late, "day")} (was due ${shortDay(todo.dueAt)}).`,
        });
      }
    }

    const waiting = waitingState(todo, now, prefs);
    if (dayKindsOpen && waiting?.chaseDue) {
      // A sign-off request is a kind of waiting: same clock, same cadence, same
      // notification kind; only the wording says what is pending.
      const signoff = awaitingSignoff(todo);
      const pending = signoff
        ? (approverName(signoff.approver) ?? todo.waitingOn?.trim())
        : null;
      out.push({
        todoId: todo.id,
        kind: "chaser",
        key: `chaser:${todo.id}:${waiting.sinceDay}:${waiting.round}`,
        title: todo.title,
        body: pending
          ? `Sign-off pending from ${pending} with no update for ${plural(waiting.quietDays, "working day")}. Time to chase?`
          : `Waiting on ${todo.waitingOn?.trim()} with no update for ${plural(waiting.quietDays, "working day")}. Time to chase?`,
      });
    }
  }

  if (prefs.digest && dayKindsOpen && open.length > 0) {
    const titles = open.slice(0, 5).map((todo) => `- ${todo.title}`);
    const more =
      open.length > titles.length ? [`+${open.length - titles.length} more`] : [];
    out.push({
      todoId: null,
      kind: "digest",
      key: `digest:${today}`,
      title: `PMO To-Do: ${plural(open.length, "open item")}`,
      body: [...titles, ...more].join("\n"),
      count: open.length,
    });
  }

  const dueDay = new Map(open.map((todo) => [todo.id, todo.dueAt ?? "9999-99-99"]));
  return out.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      (dueDay.get(a.todoId ?? "") ?? "").localeCompare(
        dueDay.get(b.todoId ?? "") ?? "",
      ) ||
      a.key.localeCompare(b.key),
  );
}

// ---------------------------------------------------------------------------
// What the notification says (privacy default) and the badge count
// ---------------------------------------------------------------------------

export interface Toast {
  title: string;
  body: string;
  /** Set only when the toast is about exactly one to-do: clicking opens it. */
  todoId: string | null;
}

/** One toast for a batch of notifications. With `hideDetails` (the default)
 *  the text is only "PMO To-Do: N items need attention": no title, no name. */
export function toastFor(
  batch: readonly DueNotification[],
  prefs: Pick<ReminderPrefs, "hideDetails">,
): Toast | null {
  if (batch.length === 0) return null;
  const ids = [...new Set(batch.flatMap((n) => (n.todoId ? [n.todoId] : [])))];
  const digestOnly = ids.length === 0;
  const count = digestOnly ? 0 : ids.length;
  const todoId = ids.length === 1 ? ids[0] : null;

  const headlineFor = (n: number) =>
    `PMO To-Do: ${n} ${n === 1 ? "item needs" : "items need"} attention`;
  if (digestOnly) {
    const digest = batch[0];
    return prefs.hideDetails
      ? { title: headlineFor(digest.count ?? 0), body: "", todoId: null }
      : { title: digest.title, body: digest.body, todoId: null };
  }
  const headline = headlineFor(count);
  if (prefs.hideDetails) return { title: headline, body: "", todoId };
  if (batch.length === 1) return { title: batch[0].title, body: batch[0].body, todoId };
  const lines = batch.slice(0, 4).map((n) => `- ${n.title}`);
  const more =
    batch.length > lines.length ? [`+${batch.length - lines.length} more`] : [];
  return { title: headline, body: [...lines, ...more].join("\n"), todoId };
}

export interface Attention {
  /** Distinct open, un-snoozed to-dos that need a look right now. */
  count: number;
  /** Due before today. */
  overdue: number;
  /** Due today or tomorrow. */
  dueSoon: number;
  /** Waiting on someone for at least `chaserDays` working days. */
  waiting: number;
}

export const isDueSoon = (todo: Pick<Todo, "dueAt" | "status">, today: string): boolean =>
  todo.status === "open" &&
  todo.dueAt !== null &&
  todo.dueAt >= today &&
  todo.dueAt <= addDays(today, 1);

export const isWaiting = (todo: Pick<Todo, "waitingOn" | "status">): boolean =>
  todo.status === "open" && !!todo.waitingOn?.trim();

/** The number on the dock badge. State based (what needs a look now), unlike
 *  `computeDue` (what to announce now), so it does not depend on quiet hours. */
export function attentionSummary(
  todos: readonly Todo[],
  now: Date,
  prefs: ReminderPrefs,
): Attention {
  const today = localParts(now, prefs.timeZone).day;
  const ids = new Set<string>();
  let overdue = 0;
  let dueSoon = 0;
  let waiting = 0;
  for (const todo of todos) {
    if (todo.status !== "open" || isSnoozed(todo, now)) continue;
    if (todo.dueAt && todo.dueAt < today) {
      overdue++;
      ids.add(todo.id);
    } else if (isDueSoon(todo, today)) {
      dueSoon++;
      ids.add(todo.id);
    }
    if (waitingState(todo, now, prefs)?.chaseDue) {
      waiting++;
      ids.add(todo.id);
    }
  }
  return { count: ids.size, overdue, dueSoon, waiting };
}
