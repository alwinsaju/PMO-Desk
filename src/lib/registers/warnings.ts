// Soft checks on a record being edited: things that are probably a slip but are allowed (the form shows them in
// amber and still saves). Pure. A rule that must block a save lives in `crossCheck` in records.ts instead.
import { addDays, daysBetween, mondayOf, weekdayIndex } from "../staff/dates.ts";
import { normaliseMonth } from "./month.ts";
import type { FieldValue, RegisterDef, RegisterRecord } from "./types.ts";

export type Warnings = Record<string, string>;

const text = (values: Record<string, FieldValue>, key: string): string => {
  const v = values[key];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The first day of a yyyy-mm month, and the last. */
function monthSpan(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  const next = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1),
  );
  return { first, last: addDays(next.toISOString().slice(0, 10), -1) };
}

/**
 * What looks wrong, by field key (the message is shown under that field). `others` are the other records of
 * the tool (the one being edited is left out by its id) and `today` is yyyy-mm-dd. Only fields that hold a
 * real date are compared.
 */
export function recordWarnings(
  def: RegisterDef,
  values: Record<string, FieldValue>,
  others: readonly RegisterRecord[],
  selfId: string | null,
  today: string,
): Warnings {
  const out: Warnings = {};
  const others2 = others.filter((o) => o.id !== selfId);

  // The same reference twice (change requests, SLA items): not blocked, because a reference can be reused on purpose.
  if (def.id === "changes" || def.id === "sla") {
    const ref = text(values, "ref").toLowerCase();
    if (ref && others2.some((o) => text(o.values, "ref").toLowerCase() === ref)) {
      out.ref = `Another entry already uses ${text(values, "ref")}. Check this is not a duplicate.`;
    }
  }

  if (def.id === "stakeholders") {
    const last = text(values, "lastContact");
    if (isDay(last) && last > today) {
      out.lastContact = "This date is in the future. Log contact on the day it happens.";
    }
  }

  if (def.id === "vendors") {
    const start = text(values, "startDate");
    const renewal = text(values, "renewalDate");
    const notice = Number(text(values, "noticeDays") || 0);
    if (isDay(start) && isDay(renewal) && Number.isFinite(notice)) {
      const deadline = addDays(renewal, -notice);
      if (deadline < start && renewal >= start) {
        out.noticeDays = `The notice deadline (${deadline}) would fall before the contract starts. Check the notice period.`;
      }
    }
  }

  if (def.id === "invoices") {
    const month = normaliseMonth(text(values, "month"));
    const sendBy = text(values, "sendBy");
    if (month && isDay(sendBy)) {
      const { first, last } = monthSpan(month);
      if (daysBetween(sendBy, first) > 31) {
        out.sendBy = `Send by is more than a month before the invoice month (${month}).`;
      } else if (daysBetween(last, sendBy) > 92) {
        out.sendBy = `Send by is more than three months after the invoice month (${month}).`;
      }
    }
  }

  if (def.id === "capacity") {
    const percent = Number(text(values, "percent"));
    if (text(values, "percent") !== "" && Number.isFinite(percent)) {
      if (percent === 0) {
        out.percent = "0% means no time on this project. Is the row needed?";
      } else if (percent > 100) {
        out.percent =
          "Over 100% for one project. The planner will show this person as over capacity.";
      }
    }
  }

  if (def.id === "timesheets") {
    const week = text(values, "week");
    if (isDay(week) && weekdayIndex(week) !== 0) {
      out.week = `This is not a Monday. It counts as the week of ${mondayOf(week)}.`;
    }
  }

  return out;
}
