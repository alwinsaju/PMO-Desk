"use client";

import { useMemo } from "react";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { useRoster } from "@/components/apps/dashboard-app/useDashboardData";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { dayName, formatDate, todayIso } from "@/lib/staff/dates";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import { whosOff } from "@/lib/staff/whosOff";

const MAX_NAMES = 5;

function WhosOutToday() {
  useStaffSync();
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const shifts = useStaffStore((s) => s.shifts);
  const status = useStaffStore((s) => s.status);
  const roster = useRoster();
  const today = todayIso(new Date());
  const result = useMemo(
    () =>
      whosOff({
        from: today,
        to: today,
        employees,
        timeOff,
        shifts,
        members: roster.members,
        events: roster.events,
        includePending: false,
      }),
    [today, employees, timeOff, shifts, roster],
  );
  const shown = result.entries.slice(0, MAX_NAMES);
  return (
    <aside
      aria-label="Who's out today"
      className="glass rounded-card pointer-events-auto absolute top-24 left-4 z-[1] w-60 px-4 py-3"
    >
      <p className="text-ink-muted flex items-center gap-2 text-[11.5px] font-bold tracking-[0.05em] uppercase">
        <UsersThreeIcon size={14} aria-hidden />
        Out today · {dayName(today)} {formatDate(today)}
      </p>
      {status !== "ready" ? (
        <p className="text-ink-muted mt-2 text-[13px]">Checking…</p>
      ) : shown.length === 0 ? (
        <p className="text-ink mt-2 text-[13.5px] font-semibold">Everyone is in.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {shown.map((e) => (
            <li key={e.key} className="text-ink text-[13.5px]">
              <span className="font-semibold">{e.name}</span>
              <span className="text-ink-muted"> · {e.label}</span>
            </li>
          ))}
          {result.entries.length > MAX_NAMES && (
            <li className="text-ink-muted text-[12.5px]">
              +{result.entries.length - MAX_NAMES} more
            </li>
          )}
        </ul>
      )}
    </aside>
  );
}

/** The optional desktop card (Settings > General): who is out today. Behind every window. */
export function DesktopWidget() {
  const on = usePreferences((s) => s.desktopWidget);
  return on ? <WhosOutToday /> : null;
}
