"use client";

import { useMemo } from "react";
import { displayName } from "@/lib/staff/employees";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import type { LeaveSpan, Person } from "@/lib/registers/timesheets";

/** The people on the roster (for suggestions and chasers) and their approved leave. */
export function usePeople(): { people: Person[]; names: string[]; leave: LeaveSpan[] } {
  useStaffSync();
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  return useMemo(() => {
    const people = employees.map((e) => ({
      id: e.id,
      name: displayName(e),
      email: e.deloitteEmail,
    }));
    return {
      people,
      names: people.map((p) => p.name).sort((a, b) => a.localeCompare(b)),
      leave: timeOff
        .filter((r) => r.status === "approved")
        .map((r) => ({
          employeeId: r.employeeId,
          startDate: r.startDate,
          endDate: r.endDate,
        })),
    };
  }, [employees, timeOff]);
}

/** The email of a person named in a record (case-insensitive), or "". */
export function emailOf(people: readonly Person[], name: string): string {
  const wanted = name.trim().toLowerCase();
  return people.find((p) => p.name.toLowerCase() === wanted)?.email ?? "";
}
