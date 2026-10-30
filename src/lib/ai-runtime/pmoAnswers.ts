// Answers a recognised PMO question or request (pmoIntent.ts) from the real data:
// the Staff roster, the PMO to-dos and the task catalog. Used by /api/ai/pmo (the
// no-model path) and by /api/ai/command (when the model picks one of these tools),
// so both give the same answer. Data comes in through `PmoDeps`, so tests can
// hand it fixtures and the live version (pmoAnswers.live.ts) reads the real files.
import { openTodos, overdueChasers } from "../dashboard/summary.ts";
import { localParts } from "../pmo/due.ts";
import type { ReminderPrefs, Todo } from "../pmo/types.ts";
import { whosOff, type WhosOffInput } from "../staff/whosOff.ts";
import { taskById } from "../tasks-engine/catalog.ts";
import type { PmoIntent } from "./pmoIntent.ts";
import { unknownWhenReply, whosOffReply, statusReply } from "./pmoReply.ts";
import { resolveWhen } from "./whenPhrase.ts";
import { suggestWhen } from "./didYouMean.ts";
import {
  changesReply,
  findPeople,
  noPersonReply,
  personBackReply,
  personShiftReply,
  severalPeopleReply,
  sinceDay,
  unknownSinceReply,
} from "./pmoPeople.ts";
import type { ShiftSchedule } from "../staff/types.ts";

/** What a reply can be: the same shape the command route returns to the bar. */
export type PmoAnswer =
  | { type: "message"; text: string }
  | { type: "action"; name: "prepare_task"; arguments: { taskId: string } }
  | { type: "error"; kind: "malformed"; message: string };

export type StaffData = Pick<
  WhosOffInput,
  "employees" | "timeOff" | "shifts" | "members" | "events"
> & {
  /** The roster's shift schedules, to name a shift ("Shift-2 (14:00 to 22:00 IST)"). */
  schedules?: readonly ShiftSchedule[];
};

export interface PmoDeps {
  now: () => Date;
  /** The reminder time zone, which decides what "today" is. */
  timeZone: () => Promise<string>;
  staff: () => Promise<StaffData>;
  pmo: () => Promise<{
    todos: readonly Todo[];
    prefs: Pick<ReminderPrefs, "timeZone" | "workDays" | "chaserDays">;
  }>;
}

export async function answerPmoIntent(
  intent: PmoIntent,
  deps: PmoDeps,
): Promise<PmoAnswer> {
  switch (intent.kind) {
    case "whos_off": {
      const today = localParts(deps.now(), await deps.timeZone()).day;
      const range = resolveWhen(intent.when, today);
      if (!range) {
        const suggestion = suggestWhen(intent.when, today, resolveWhen);
        return { type: "message", text: unknownWhenReply(intent.when, suggestion) };
      }
      const result = whosOff({ ...range, ...(await deps.staff()), includePending: true });
      return { type: "message", text: whosOffReply(range, result) };
    }
    case "pmo_status": {
      const { todos, prefs } = await deps.pmo();
      const now = deps.now();
      const today = localParts(now, prefs.timeZone).day;
      return {
        type: "message",
        text: statusReply(intent.topic, {
          // Every overdue to-do is listed (the reply caps what it shows).
          todos: openTodos(todos, now, prefs, todos.length),
          chasers: overdueChasers(todos, now, prefs),
          today,
        }),
      };
    }
    case "person_back":
    case "person_shift": {
      const today = localParts(deps.now(), await deps.timeZone()).day;
      const staff = await deps.staff();
      const found = findPeople(intent.name, staff.employees, staff.members);
      if (found.length === 0)
        return { type: "message", text: noPersonReply(intent.name) };
      if (found.length > 1) {
        return { type: "message", text: severalPeopleReply(intent.name, found) };
      }
      const text =
        intent.kind === "person_back"
          ? personBackReply(found[0], today, staff)
          : personShiftReply(found[0], intent.when || "today", today, {
              shifts: staff.shifts,
              schedules: staff.schedules ?? [],
            });
      return { type: "message", text };
    }
    case "changes": {
      const { todos, prefs } = await deps.pmo();
      const today = localParts(deps.now(), prefs.timeZone).day;
      const since = sinceDay(intent.since, today);
      if (!since) return { type: "message", text: unknownSinceReply(intent.since) };
      const staff = await deps.staff();
      return {
        type: "message",
        text: changesReply({
          since,
          today,
          timeZone: prefs.timeZone,
          todos,
          timeOff: staff.timeOff,
          employees: staff.employees,
        }),
      };
    }
    case "prepare_task": {
      if (!taskById(intent.taskId)) {
        return { type: "error", kind: "malformed", message: "That task does not exist." };
      }
      return {
        type: "action",
        name: "prepare_task",
        arguments: { taskId: intent.taskId },
      };
    }
  }
}
