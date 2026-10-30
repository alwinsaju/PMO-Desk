// The live data behind the command bar's PMO answers: the real Staff files and the
// PMO store. Server only (imported by the /api/ai routes).
import { DEFAULT_TIME_ZONE } from "../pmo/types.ts";
import { ensureIngest } from "../pmo/server/service.ts";
import { readRoster, readStaff } from "../staff/server.ts";
import type { PmoDeps } from "./pmoAnswers.ts";

/** The PMO config's reminder settings, or null when the PMO service cannot start. */
async function reminders() {
  try {
    return (await (await ensureIngest()).store.loadConfig()).reminders;
  } catch {
    return null;
  }
}

export const livePmoDeps: PmoDeps = {
  now: () => new Date(),
  timeZone: async () => (await reminders())?.timeZone ?? DEFAULT_TIME_ZONE,
  staff: async () => {
    const [employees, timeOff, shifts, roster] = await Promise.all([
      readStaff("employees"),
      readStaff("timeoff"),
      readStaff("shifts"),
      readRoster(),
    ]);
    return {
      employees,
      timeOff,
      shifts,
      members: roster.members,
      events: roster.events,
      schedules: roster.schedules,
    };
  },
  pmo: async () => {
    const pmo = await ensureIngest();
    const [todos, config] = await Promise.all([
      pmo.store.listTodos(),
      pmo.store.loadConfig(),
    ]);
    return { todos, prefs: config.reminders };
  },
};
