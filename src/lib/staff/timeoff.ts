// Pure time-off logic: types and statuses, stats, overlap checks, filtering.
import { inclusiveDays, isIsoDate, workingDays } from "./dates.ts";
import type { Tone } from "./rosterCatalog.ts";
import type { Employee, TimeOffRequest, TimeOffStatus, TimeOffType } from "./types.ts";
import { displayName } from "./employees.ts";

export const TIME_OFF_META: Record<TimeOffType, { label: string; tone: Tone }> = {
  pto: { label: "PTO", tone: "accent" },
  sick: { label: "Sick leave", tone: "red" },
  "public-holiday": { label: "Public holiday", tone: "info" },
  "comp-off": { label: "Comp off", tone: "success" },
  parental: { label: "Parental leave", tone: "amber" },
  other: { label: "Other", tone: "neutral" },
};

export const STATUS_META: Record<TimeOffStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "red" },
};

export function newRequestId(): string {
  const hex =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2).padEnd(12, "0");
  return `to_${hex.slice(0, 12)}`;
}

export const TIME_OFF_ID = /^to_[0-9a-f]{8,32}$/;

export function createTimeOff(
  input: Partial<TimeOffRequest> &
    Pick<TimeOffRequest, "employeeId" | "startDate" | "endDate">,
  now: string = new Date().toISOString(),
): TimeOffRequest {
  return {
    id: newRequestId(),
    type: "pto",
    reason: "",
    status: "pending",
    createdAt: now,
    decidedAt: "",
    ...input,
  };
}

const overlaps = (a: TimeOffRequest, b: Pick<TimeOffRequest, "startDate" | "endDate">) =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

export type TimeOffErrors = Partial<
  Record<"employeeId" | "startDate" | "endDate", string>
>;

export function validateTimeOff(
  draft: TimeOffRequest,
  all: readonly TimeOffRequest[],
  knownEmployeeIds: ReadonlySet<string>,
): TimeOffErrors {
  const errors: TimeOffErrors = {};
  if (!knownEmployeeIds.has(draft.employeeId)) errors.employeeId = "Choose an employee.";
  if (!isIsoDate(draft.startDate)) errors.startDate = "Choose a start date.";
  if (!isIsoDate(draft.endDate)) errors.endDate = "Choose an end date.";
  if (!errors.startDate && !errors.endDate) {
    if (draft.endDate < draft.startDate) {
      errors.endDate = "The end date is before the start date.";
    } else if (
      all.some(
        (r) =>
          r.id !== draft.id &&
          r.employeeId === draft.employeeId &&
          r.status !== "rejected" &&
          overlaps(r, draft),
      )
    ) {
      errors.startDate = "This person already has time off in these dates.";
    }
  }
  return errors;
}

export function dayCount(request: Pick<TimeOffRequest, "startDate" | "endDate">): {
  calendar: number;
  working: number;
} {
  return {
    calendar: inclusiveDays(request.startDate, request.endDate),
    working: workingDays(request.startDate, request.endDate),
  };
}

export interface TimeOffStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  /** Requests per type, most used first (zero-count types are kept). */
  byType: { type: TimeOffType; count: number }[];
  /** Approved leave that includes today. */
  awayToday: number;
}

export function timeOffStats(
  requests: readonly TimeOffRequest[],
  today: string,
): TimeOffStats {
  const count = (status: TimeOffStatus) =>
    requests.filter((r) => r.status === status).length;
  const byType = (Object.keys(TIME_OFF_META) as TimeOffType[])
    .map((type) => ({ type, count: requests.filter((r) => r.type === type).length }))
    .sort((a, b) => b.count - a.count);
  return {
    total: requests.length,
    pending: count("pending"),
    approved: count("approved"),
    rejected: count("rejected"),
    byType,
    awayToday: requests.filter(
      (r) => r.status === "approved" && r.startDate <= today && today <= r.endDate,
    ).length,
  };
}

/** Newest start date first; status and a free-text match on the person. */
export function filterTimeOff(
  requests: readonly TimeOffRequest[],
  employees: ReadonlyMap<string, Employee>,
  { status, query }: { status: TimeOffStatus | ""; query: string },
): TimeOffRequest[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return requests
    .filter((r) => {
      if (status && r.status !== status) return false;
      if (terms.length === 0) return true;
      const person = employees.get(r.employeeId);
      const haystack =
        `${person ? displayName(person) : ""} ${TIME_OFF_META[r.type].label} ${r.reason}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id));
}

/** Approved leave that has not ended yet, soonest first. */
export function upcomingLeave(
  requests: readonly TimeOffRequest[],
  employeeId: string,
  today: string,
): TimeOffRequest[] {
  return requests
    .filter(
      (r) => r.employeeId === employeeId && r.status === "approved" && r.endDate >= today,
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
