"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import { endAlerts, endAlertText, upcomingOccasions, fullName } from "@/lib/staff/people";
import { todayIso } from "@/lib/staff/dates";
import { useStaffStore } from "@/lib/staff/staffStore";
import { LeaveApprovals } from "../staff-app/LeaveApprovals";
import { Widget } from "./widgets";

/** Leave waiting for a decision (approve or reject here), roll-offs in the next 30 days and who has a
 *  birthday or anniversary this fortnight. */
export function StaffAttentionWidget({ onOpen }: { onOpen: () => void }) {
  const employees = useStaffStore((s) => s.employees);
  const pending = useStaffStore(
    (s) => s.timeOff.filter((r) => r.status === "pending").length,
  );
  const today = todayIso();
  const alerts = endAlerts(employees, today).slice(0, 4);
  const occasions = upcomingOccasions(employees, today, 7).slice(0, 3);
  return (
    <Widget
      title="Staff to act on"
      icon={UsersThreeIcon}
      count={pending + alerts.length || undefined}
      countTone={pending + alerts.length > 0 ? "warning" : "neutral"}
      openLabel="Open Staff"
      onOpen={onOpen}
      testId="staff-attention"
    >
      <LeaveApprovals limit={3} />
      {alerts.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="dash-end-alerts">
          {alerts.map((a) => (
            <li
              key={`${a.employee.id}-${a.kind}`}
              className="text-ink-soft text-[12.5px]"
            >
              {endAlertText(a)}
            </li>
          ))}
        </ul>
      )}
      {occasions.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {occasions.map((o) => (
            <li
              key={`${o.employee.id}-${o.kind}`}
              className="text-ink-muted text-[12.5px]"
            >
              {fullName(o.employee)}:{" "}
              {o.kind === "birthday" ? "birthday" : `${o.years}-year anniversary`}{" "}
              {o.daysAway === 0
                ? "today"
                : `in ${o.daysAway} day${o.daysAway === 1 ? "" : "s"}`}
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
