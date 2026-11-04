"use client";

import { useEffect, useMemo } from "react";
import { todayIso } from "@/lib/staff/dates";
import { holidayDatesFor } from "@/lib/staff/holidayDates";
import { canonicalLocation, locationChoices } from "@/lib/staff/holidays";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { Row } from "./SettingsParts";

/** Settings > General > To-dos: "My holiday location". Due dates and the Tomorrow and Next
 *  Monday snoozes then move past that location's holidays from the Staff roster. The list is
 *  the same one the Staff holiday editor offers; nothing is stored here but the one name. */
export function HolidayLocationRow() {
  const location = usePlatformPrefs((s) => s.holidayLocation);
  const config = useRosterStore((s) => s.config);
  const loaded = useRosterStore((s) => s.loaded);
  const employees = useStaffStore((s) => s.employees);

  useEffect(() => {
    if (!loaded) void useRosterStore.getState().load();
  }, [loaded]);

  const choices = useMemo(() => {
    const list = locationChoices(config.members, employees, config.events);
    // A saved place the roster no longer mentions stays selectable, so it is not lost.
    return location && !list.includes(canonicalLocation(location))
      ? [...list, location]
      : list;
  }, [config.members, config.events, employees, location]);

  const count = useMemo(
    () => (location ? holidayDatesFor(config.events, location, todayIso()).size : 0),
    [config.events, location],
  );

  const hint = !location
    ? "Not set: due dates skip weekends only. Pick a Staff location to also skip its holidays."
    : !loaded
      ? "Checking the Staff roster for holidays…"
      : count > 0
        ? `${count} holiday ${count === 1 ? "day" : "days"} in the next year are skipped for ${location}. A due date that lands on one moves to the next working day.`
        : `The Staff roster has no holidays for ${location} yet, so only weekends are skipped. Add them in Staff, Holidays by location.`;

  return (
    <Row settingId="holiday-location" title="My holiday location" hint={hint}>
      <select
        value={location}
        onChange={(e) =>
          usePlatformPrefs
            .getState()
            .update((p) => ({ ...p, holidayLocation: e.target.value }))
        }
        aria-label="My holiday location"
        className="border-line bg-chip text-ink rounded-control border px-2 py-1.5 text-[13px]"
      >
        <option value="">Not set</option>
        {choices.map((place) => (
          <option key={place} value={place}>
            {place}
          </option>
        ))}
      </select>
    </Row>
  );
}
