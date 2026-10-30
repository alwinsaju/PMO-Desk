/** Weekly and monthly schedules for tasks. The app prepares a due task only while it is open;
 *  anything that fell due while it was closed is reported as missed on the next launch. Pure. */

export type Cadence = "weekly" | "monthly";

export interface TaskSchedule {
  taskId: string;
  cadence: Cadence;
  /** 1 = Monday … 7 = Sunday (weekly). */
  weekday: number;
  /** 1–31, clamped to the month's length (monthly). */
  dayOfMonth: number;
  /** "HH:MM", local time. */
  time: string;
  /** Start the task by itself when it is due (it still stops at the first review gate). */
  autoPrepare: boolean;
}

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export const isoDayOf = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseDay = (day: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const daysInMonth = (y: number, month0: number) => new Date(y, month0 + 1, 0).getDate();

export const validTime = (time: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** Does the schedule fall on this day? */
export function occursOn(schedule: TaskSchedule, day: string): boolean {
  const d = parseDay(day);
  if (schedule.cadence === "weekly") {
    return ((d.getDay() + 6) % 7) + 1 === schedule.weekday;
  }
  const dom = Math.min(schedule.dayOfMonth, daysInMonth(d.getFullYear(), d.getMonth()));
  return d.getDate() === dom;
}

/** The latest occurrence at or before `now` (a today-occurrence counts once its time has passed),
 *  looking back at most `lookbackDays`. */
export function latestOccurrence(
  schedule: TaskSchedule,
  now: Date,
  lookbackDays = 62,
): string | null {
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (let back = 0; back <= lookbackDays; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const day = isoDayOf(d);
    if (!occursOn(schedule, day)) continue;
    if (back === 0 && clock < schedule.time) continue;
    return day;
  }
  return null;
}

export type ScheduleDue =
  | { kind: "none" }
  | { kind: "due"; day: string }
  | { kind: "missed"; day: string };

/** Whether the schedule has something unhandled: "due" if it fell today, "missed" if on an earlier day.
 *  `handledDay` is the last occurrence already prepared or reported. */
export function pendingOccurrence(
  schedule: TaskSchedule,
  handledDay: string | undefined,
  now: Date,
): ScheduleDue {
  const day = latestOccurrence(schedule, now);
  if (!day || (handledDay && handledDay >= day)) return { kind: "none" };
  return day === isoDayOf(now) ? { kind: "due", day } : { kind: "missed", day };
}

export function describeSchedule(schedule: TaskSchedule): string {
  const when =
    schedule.cadence === "weekly"
      ? `every ${WEEKDAYS[schedule.weekday - 1]}`
      : `on day ${schedule.dayOfMonth} of each month`;
  return `${when} at ${schedule.time}`;
}

export function dayLabel(day: string): string {
  return parseDay(day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** The words for a task-day reminder. `inputsReady` is whether every required file is already uploaded. */
export function scheduleMessage(
  taskName: string,
  due: Exclude<ScheduleDue, { kind: "none" }>,
  inputsReady: boolean,
  autoPrepared: boolean,
): string {
  const when = due.kind === "due" ? "is due today" : `was due ${dayLabel(due.day)}`;
  if (autoPrepared) return `${taskName} ${when}. It was prepared and is waiting at the review step.`;
  return inputsReady
    ? `${taskName} ${when}. The files are in; open Tasks to run it.`
    : `${taskName} ${when}, but not all of its files are uploaded yet.`;
}

/** A sane schedule when someone first turns one on. */
export function defaultSchedule(taskId: string): TaskSchedule {
  return {
    taskId,
    cadence: "weekly",
    weekday: 1,
    dayOfMonth: 1,
    time: "09:00",
    autoPrepare: false,
  };
}

/** Drops anything malformed from stored data. */
export function sanitizeSchedules(value: unknown): TaskSchedule[] {
  if (!Array.isArray(value)) return [];
  const out: TaskSchedule[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.taskId !== "string" || !r.taskId || seen.has(r.taskId)) continue;
    const cadence = r.cadence === "monthly" ? "monthly" : "weekly";
    const weekday = Number.isInteger(r.weekday) ? Number(r.weekday) : 1;
    const dom = Number.isInteger(r.dayOfMonth) ? Number(r.dayOfMonth) : 1;
    out.push({
      taskId: r.taskId,
      cadence,
      weekday: weekday >= 1 && weekday <= 7 ? weekday : 1,
      dayOfMonth: dom >= 1 && dom <= 31 ? dom : 1,
      time: typeof r.time === "string" && validTime(r.time) ? r.time : "09:00",
      autoPrepare: r.autoPrepare === true,
    });
    seen.add(r.taskId);
  }
  return out;
}
