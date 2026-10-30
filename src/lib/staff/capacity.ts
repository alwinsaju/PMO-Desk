/** Who is working when, per team, and where the roster falls below a team's minimum. Pure. */
import { addDays, inclusiveDays, isIsoDate } from "./dates.ts";
import { assignmentId, indexAssignments, leaveOn, resolveAssignment } from "./shifts.ts";
import type {
  Employee,
  RosterGroup,
  RosterMember,
  ShiftAssignment,
  ShiftSchedule,
  TimeOffRequest,
} from "./types.ts";

export interface CapacityInput {
  employees: readonly Employee[];
  members: readonly RosterMember[];
  groups: readonly RosterGroup[];
  schedules: readonly ShiftSchedule[];
  assignments: readonly ShiftAssignment[];
  timeOff: readonly TimeOffRequest[];
}

export interface GroupCapacity {
  groupId: string;
  name: string;
  /** On a working shift and not on approved leave. */
  working: number;
  /** Scheduled to work but away on approved leave. */
  onLeave: number;
  byShift: { label: string; count: number }[];
}

/** Minimum people working per team and day, by group id. A missing or zero entry means no rule. */
export type CoverageRules = Readonly<Record<string, number>>;

export function capacityOn(day: string, input: CapacityInput): GroupCapacity[] {
  const index = indexAssignments(input.assignments);
  const out = new Map<string, GroupCapacity>();
  const shiftCounts = new Map<string, Map<string, number>>();
  for (const group of input.groups) {
    if (group.hidden) continue;
    out.set(group.id, {
      groupId: group.id,
      name: group.name,
      working: 0,
      onLeave: 0,
      byShift: [],
    });
    shiftCounts.set(group.id, new Map());
  }
  for (const member of input.members) {
    const cap = out.get(member.groupId);
    const a = index.get(assignmentId(member.id, day));
    if (!cap || !a) continue;
    const view = resolveAssignment(a, input.schedules);
    if (!view.working) continue;
    if (member.employeeId && leaveOn(input.timeOff, member.employeeId, day)) {
      cap.onLeave += 1;
      continue;
    }
    cap.working += 1;
    const counts = shiftCounts.get(member.groupId)!;
    counts.set(view.label, (counts.get(view.label) ?? 0) + 1);
  }
  for (const [groupId, counts] of shiftCounts) {
    out.get(groupId)!.byShift = [...counts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  return [...out.values()];
}

export interface CoverageGap {
  day: string;
  groupId: string;
  name: string;
  have: number;
  need: number;
}

/** Days in the range where a team with a rule has fewer people working than its minimum. Days nobody in
 *  the team is scheduled are ignored (an unplanned day is not a gap). */
export function coverageGaps(
  from: string,
  days: number,
  input: CapacityInput,
  rules: CoverageRules,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    for (const cap of capacityOn(day, input)) {
      const need = rules[cap.groupId] ?? 0;
      if (need <= 0 || cap.working + cap.onLeave === 0) continue;
      if (cap.working < need)
        gaps.push({ day, groupId: cap.groupId, name: cap.name, have: cap.working, need });
    }
  }
  return gaps;
}

export interface LeaveBreach {
  day: string;
  groupId: string;
  name: string;
  /** People working that day if the request were approved. */
  after: number;
  need: number;
}

/** Would approving this request take a team below its minimum on any day? */
export function leaveImpact(
  request: Pick<TimeOffRequest, "employeeId" | "startDate" | "endDate">,
  input: CapacityInput,
  rules: CoverageRules,
): LeaveBreach[] {
  if (!isIsoDate(request.startDate) || !isIsoDate(request.endDate)) return [];
  const span = Math.min(inclusiveDays(request.startDate, request.endDate), 62);
  const mine = input.members.filter((m) => m.employeeId === request.employeeId);
  if (mine.length === 0) return [];
  const index = indexAssignments(input.assignments);
  const breaches: LeaveBreach[] = [];
  for (let i = 0; i < span; i++) {
    const day = addDays(request.startDate, i);
    const caps = capacityOn(day, input);
    for (const member of mine) {
      const a = index.get(assignmentId(member.id, day));
      if (!a || !resolveAssignment(a, input.schedules).working) continue;
      if (leaveOn(input.timeOff, request.employeeId, day)) continue;
      const cap = caps.find((c) => c.groupId === member.groupId);
      const need = rules[member.groupId] ?? 0;
      if (!cap || need <= 0) continue;
      const after = cap.working - 1;
      if (after < need)
        breaches.push({ day, groupId: cap.groupId, name: cap.name, after, need });
    }
  }
  return breaches;
}

export function breachText(breaches: readonly LeaveBreach[]): string {
  if (breaches.length === 0) return "";
  const first = breaches[0];
  const more =
    breaches.length > 1
      ? ` (and ${breaches.length - 1} more day${breaches.length > 2 ? "s" : ""})`
      : "";
  return `Would leave ${first.name} with ${first.after} on ${first.day}, below its minimum of ${first.need}${more}.`;
}
