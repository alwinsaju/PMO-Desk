/** Leave: balances, a templated reply, pasted date lists and shift swaps. Pure. */
import { addDays, isIsoDate, isWeekend, todayIso } from "./dates.ts";
import { assignmentId } from "./shifts.ts";
import type { ShiftAssignment, TimeOffRequest } from "./types.ts";

// --- balances ---------------------------------------------------------------------------------

export interface LeaveBalance {
  allowance: number;
  used: number;
  pending: number;
  remaining: number;
}

/** Working days (Mon-Fri, minus `holidays`) of a request that fall inside `year`. */
export function leaveDaysInYear(
  request: Pick<TimeOffRequest, "startDate" | "endDate">,
  year: number,
  holidays: ReadonlySet<string> = new Set(),
): number {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  let day = request.startDate < from ? from : request.startDate;
  const end = request.endDate > to ? to : request.endDate;
  let count = 0;
  for (let guard = 0; day <= end && guard < 400; guard++, day = addDays(day, 1)) {
    if (!isWeekend(day) && !holidays.has(day)) count++;
  }
  return count;
}

export function leaveBalance(
  employeeId: string,
  requests: readonly TimeOffRequest[],
  year: number,
  allowance: number,
  holidays?: ReadonlySet<string>,
): LeaveBalance {
  let used = 0;
  let pending = 0;
  for (const r of requests) {
    if (r.employeeId !== employeeId || r.type !== "pto") continue;
    const days = leaveDaysInYear(r, year, holidays);
    if (r.status === "approved") used += days;
    else if (r.status === "pending") pending += days;
  }
  return { allowance, used, pending, remaining: allowance - used };
}

// --- reply ------------------------------------------------------------------------------------

export function leaveReply(
  request: Pick<TimeOffRequest, "startDate" | "endDate" | "type">,
  firstName: string,
  decision: "approved" | "rejected",
  from: string,
  note = "",
): { subject: string; body: string } {
  const when =
    request.startDate === request.endDate
      ? request.startDate
      : `${request.startDate} to ${request.endDate}`;
  const verb = decision === "approved" ? "approved" : "not approved";
  return {
    subject: `Your leave request (${when}) is ${verb}`,
    body: [
      `Hi ${firstName || "there"},`,
      "",
      decision === "approved"
        ? `Your ${request.type} request for ${when} is approved. Enjoy the time off.`
        : `I'm sorry, I can't approve your ${request.type} request for ${when}.`,
      note.trim(),
      "",
      "Thanks,",
      from,
    ]
      .filter((l, i, all) => l !== "" || all[i - 1] !== "")
      .join("\n"),
  };
}

// --- pasted date lists ------------------------------------------------------------------------

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const monthIndex = (word: string): number =>
  MONTHS.indexOf(word.slice(0, 3).toLowerCase());

const pad = (n: number) => String(n).padStart(2, "0");
const real = (y: number, m: number, d: number): string | null => {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return m >= 1 && m <= 12 && d >= 1 && isIsoDate(iso) ? iso : null;
};

export interface DateRange {
  start: string;
  end: string;
}

export interface ParsedDates {
  ranges: DateRange[];
  /** Pieces that could not be read. */
  unreadable: string[];
}

/** "5-7 Nov, 12 Nov" -> [Nov 5-7, Nov 12]. Years are taken from `today`; a date more than two months in
 *  the past is read as next year. Day-month order only (no 5/11 guessing). */
export function parseDateList(text: string, today: string = todayIso()): ParsedDates {
  const year = Number(today.slice(0, 4));
  const settle = (m: number, d: number, y?: number): string | null => {
    if (y) return real(y, m, d);
    const first = real(year, m, d);
    if (first && first < addDays(today, -62)) return real(year + 1, m, d);
    return first;
  };
  const ranges: DateRange[] = [];
  const unreadable: string[] = [];
  for (const raw of text.split(/[,;\n]|\band\b/i)) {
    const part = raw.trim();
    if (!part) continue;
    let m: RegExpExecArray | null;
    const iso = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:-|–|to)\s*(\d{4}-\d{2}-\d{2}))?$/.exec(
      part,
    );
    if (iso) {
      const a = iso[1];
      const b = iso[2] ?? a;
      if (isIsoDate(a) && isIsoDate(b) && a <= b) ranges.push({ start: a, end: b });
      else unreadable.push(part);
      continue;
    }
    // 5-7 Nov [2026]
    if (
      (m = /^(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/.exec(
        part,
      ))
    ) {
      const mo = monthIndex(m[3]) + 1;
      const y = m[4] ? Number(m[4]) : undefined;
      const a = mo > 0 ? settle(mo, Number(m[1]), y) : null;
      const b = mo > 0 ? settle(mo, Number(m[2]), y) : null;
      if (a && b && a <= b) ranges.push({ start: a, end: b });
      else unreadable.push(part);
      continue;
    }
    // 5 Nov - 7 Dec [2026]
    if (
      (m =
        /^(\d{1,2})\s+([A-Za-z]{3,9})\s*(?:-|–|to)\s*(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/.exec(
          part,
        ))
    ) {
      const m1 = monthIndex(m[2]) + 1;
      const m2 = monthIndex(m[4]) + 1;
      const y = m[5] ? Number(m[5]) : undefined;
      const a = m1 > 0 ? settle(m1, Number(m[1]), y) : null;
      const b = m2 > 0 ? settle(m2, Number(m[3]), y) : null;
      if (a && b && a <= b) ranges.push({ start: a, end: b });
      else unreadable.push(part);
      continue;
    }
    // 12 Nov [2026]  or  Nov 12 [2026]
    if (
      (m = /^(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?$/.exec(part)) ||
      (m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(part))
    ) {
      const dayFirst = /^\d/.test(part);
      const mo = monthIndex(dayFirst ? m[2] : m[1]) + 1;
      const d = Number(dayFirst ? m[1] : m[2]);
      const a = mo > 0 ? settle(mo, d, m[3] ? Number(m[3]) : undefined) : null;
      if (a) ranges.push({ start: a, end: a });
      else unreadable.push(part);
      continue;
    }
    unreadable.push(part);
  }
  return { ranges, unreadable };
}

// --- swaps ------------------------------------------------------------------------------------

export interface SwapRequest {
  id: string;
  memberA: string;
  dateA: string;
  memberB: string;
  dateB: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export type SwapCheck = { ok: true } | { ok: false; reason: string };

/** Both people must have a day entered, and the two days must differ. */
export function checkSwap(
  swap: Pick<SwapRequest, "memberA" | "dateA" | "memberB" | "dateB">,
  assignments: readonly ShiftAssignment[],
): SwapCheck {
  if (swap.memberA === swap.memberB && swap.dateA === swap.dateB)
    return { ok: false, reason: "That is the same day for the same person." };
  if (!isIsoDate(swap.dateA) || !isIsoDate(swap.dateB))
    return { ok: false, reason: "Choose both dates." };
  const a = assignments.find((x) => x.id === assignmentId(swap.memberA, swap.dateA));
  const b = assignments.find((x) => x.id === assignmentId(swap.memberB, swap.dateB));
  if (!a || !b) return { ok: false, reason: "Both days need a shift entered first." };
  if (a.ref === b.ref && (a.text ?? "") === (b.text ?? ""))
    return {
      ok: false,
      reason: "Both days are already the same, so there is nothing to swap.",
    };
  return { ok: true };
}

/** The two roster changes an approved swap makes: each person takes the other's day. Marked as swaps. */
export function swapAssignments(
  swap: Pick<SwapRequest, "memberA" | "dateA" | "memberB" | "dateB" | "reason">,
  assignments: readonly ShiftAssignment[],
): ShiftAssignment[] {
  const a = assignments.find((x) => x.id === assignmentId(swap.memberA, swap.dateA));
  const b = assignments.find((x) => x.id === assignmentId(swap.memberB, swap.dateB));
  if (!a || !b) return [];
  const note = swap.reason.trim().slice(0, 80);
  const give = (
    id: string,
    memberId: string,
    date: string,
    from: ShiftAssignment,
  ): ShiftAssignment => ({
    id,
    memberId,
    date,
    ref: from.ref,
    ...(from.text ? { text: from.text } : {}),
    swap: true,
    ...(note ? { note } : {}),
  });
  return [
    give(a.id, swap.memberA, swap.dateA, b),
    give(b.id, swap.memberB, swap.dateB, a),
  ];
}
