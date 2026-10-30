"use client";

import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { todayIso } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import { findPerson, profileLines } from "@/lib/staff/profileCard";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { assignmentId, leaveOn, resolveAssignment } from "@/lib/staff/shifts";
import { useStaffStore } from "@/lib/staff/staffStore";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import { EmployeeAvatar } from "../apps/staff-app/parts";

/**
 * A person's name that opens a small profile card: photo, team, level, where they are and what their day
 * looks like (shift or leave). Plain text when the name is not in the Staff directory.
 */
export function PersonName({
  name,
  employeeId,
  className,
}: {
  name: string;
  employeeId?: string | null;
  className?: string;
}) {
  const employees = useStaffStore((s) => s.employees);
  const person = useMemo(
    () => findPerson(employees, name, employeeId),
    [employees, name, employeeId],
  );
  if (!person) return <span className={className}>{name}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "focus-visible:ring-focus rounded-[3px] text-left underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2",
            className,
          )}
          title="Show profile"
        >
          {name}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-4">
        <Card employeeId={person.id} />
      </PopoverContent>
    </Popover>
  );
}

function Card({ employeeId }: { employeeId: string }) {
  const employee = useStaffStore((s) => s.employees.find((e) => e.id === employeeId));
  const assignments = useStaffStore((s) => s.shifts);
  const timeOff = useStaffStore((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  if (!employee) return null;
  const today = todayIso();
  const member = config.members.find((m) => m.employeeId === employee.id);
  const a = member
    ? assignments.find((x) => x.id === assignmentId(member.id, today))
    : undefined;
  const leave = leaveOn(timeOff, employee.id, today);
  const shiftToday = a ? resolveAssignment(a, config.schedules) : null;
  const day = leave
    ? `On leave today (${TIME_OFF_META[leave.type].label})`
    : shiftToday
      ? `${shiftToday.label}${shiftToday.hours ? ` ${shiftToday.hours}` : ""} today`
      : "No shift entered today";
  return (
    <div className="flex flex-col gap-2.5" data-testid="profile-card">
      <div className="flex items-center gap-3">
        <EmployeeAvatar employee={employee} size="lg" />
        <div className="min-w-0">
          <p className="text-ink truncate text-[14.5px] font-bold">
            {displayName(employee)}
          </p>
          <p className="text-ink-muted truncate text-[12.5px]">
            {[employee.level, employee.team].filter(Boolean).join(" · ") ||
              "No role on file"}
          </p>
        </div>
      </div>
      <p className="text-ink-soft text-[13px]">{day}</p>
      <ul className="text-ink-muted flex flex-col gap-0.5 text-[12.5px]">
        {profileLines(employee).map((l) => (
          <li key={l} className="break-words">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
