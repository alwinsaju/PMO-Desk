// The weekly strip of the Schedule tab: which workflow runs on which of the next seven days. Pure.
import {
  defaultSchedule,
  isoDayOf,
  occursOn,
  type TaskSchedule,
} from "../../../lib/tasks/taskSchedule.ts";

export interface StripDay {
  /** Local "YYYY-MM-DD". */
  day: string;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  label: string;
  isToday: boolean;
}

export interface StripCell {
  day: string;
  weekday: number;
  runs: boolean;
}

export interface StripRow {
  taskId: string;
  cadence: TaskSchedule["cadence"] | null;
  time: string | null;
  cells: StripCell[];
}

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Today and the six days after it. */
export function stripDays(now: Date): StripDay[] {
  return Array.from({ length: 7 }, (_, ahead) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const weekday = ((d.getDay() + 6) % 7) + 1;
    return {
      day: isoDayOf(d),
      weekday,
      label: ahead === 0 ? "Today" : SHORT_DAYS[weekday - 1],
      isToday: ahead === 0,
    };
  });
}

export function stripRows(
  taskIds: readonly string[],
  schedules: readonly TaskSchedule[],
  now: Date,
): StripRow[] {
  const days = stripDays(now);
  return taskIds.map((taskId) => {
    const schedule = schedules.find((s) => s.taskId === taskId) ?? null;
    return {
      taskId,
      cadence: schedule?.cadence ?? null,
      time: schedule?.time ?? null,
      cells: days.map(({ day, weekday }) => ({
        day,
        weekday,
        runs: schedule ? occursOn(schedule, day) : false,
      })),
    };
  });
}

/** What clicking a day does: no schedule becomes a weekly one on that day, the day it already
 *  runs turns it off, another day moves it. A monthly schedule is left alone. */
export function toggleWeekday(
  schedule: TaskSchedule | null,
  taskId: string,
  weekday: number,
): TaskSchedule | null {
  if (!schedule) return { ...defaultSchedule(taskId), weekday };
  if (schedule.cadence !== "weekly") return schedule;
  return schedule.weekday === weekday ? null : { ...schedule, weekday };
}
