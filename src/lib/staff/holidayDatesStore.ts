// Where the PMO to-do screens and the command bar get "the person's holiday days".
// It joins two things that already exist: the saved "My holiday location"
// (platform prefs, Settings > General) and the Staff roster's holiday events (the
// roster store, read from GET /api/staff/roster). Nothing new is stored or fetched
// for a person with no location: the roster is not even requested.
// Pure maths lives in holidayDates.ts; this file is only the wiring.
import { useEffect } from "react";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { holidayDatesFor, NO_HOLIDAYS } from "./holidayDates.ts";
import { useRosterStore } from "./rosterStore.ts";
import type { RosterEvent } from "./types.ts";

// One entry is enough (one location, one roster, one day), and it means a list with
// a snooze button on every row computes the set once, not once per row.
let cache: {
  location: string;
  events: readonly RosterEvent[];
  today: string;
  dates: ReadonlySet<string>;
} | null = null;

function datesFor(
  location: string,
  events: readonly RosterEvent[],
  today: string,
): ReadonlySet<string> {
  if (!location) return NO_HOLIDAYS;
  if (
    cache &&
    cache.location === location &&
    cache.events === events &&
    cache.today === today
  ) {
    return cache.dates;
  }
  const dates = holidayDatesFor(events, location, today);
  cache = { location, events, today, dates };
  return dates;
}

/** Holiday days for the next ~400 days from `today` (yyyy-mm-dd), as a stable set:
 *  the same object until the location, the roster's events or the day change, so it is
 *  safe in a dependency list. Empty when no location is set. */
export function useHolidayDates(today: string): ReadonlySet<string> {
  const location = usePlatformPrefs((s) => s.holidayLocation);
  const events = useRosterStore((s) => s.config.events);
  const loaded = useRosterStore((s) => s.loaded);

  useEffect(() => {
    if (location && !loaded) void useRosterStore.getState().load();
  }, [location, loaded]);

  return datesFor(location, events, today);
}

/** The same set for code that is not a component (the command bar). Loads the roster
 *  first when it has not been read yet; never throws, and falls back to "no holidays"
 *  (today's behaviour) if the roster cannot be reached. */
export async function loadHolidayDates(today: string): Promise<ReadonlySet<string>> {
  const location = usePlatformPrefs.getState().holidayLocation;
  if (!location) return NO_HOLIDAYS;
  try {
    if (!useRosterStore.getState().loaded) await useRosterStore.getState().load();
    return datesFor(location, useRosterStore.getState().config.events, today);
  } catch {
    return NO_HOLIDAYS;
  }
}
