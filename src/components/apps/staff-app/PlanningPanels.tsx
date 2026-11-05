"use client";

import { useMemo, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Button, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  addDays,
  addMonths,
  formatDate,
  formatMonth,
  monthStart,
  todayIso,
} from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import {
  buildIcs,
  rosterRows,
  timeOffIcs,
  timeOffRows,
  toCsv,
} from "@/lib/staff/exportFiles";
import { COUNTRIES, holidayEvents, type CountryId } from "@/lib/staff/holidayRules";
import { balanceBar, holidayMonth } from "@/lib/staff/insightsData";
import {
  checkSwap,
  leaveBalance,
  swapAssignments,
  type SwapRequest,
} from "@/lib/staff/leave";
import { holidayDays, onCallDays, planOnCall } from "@/lib/staff/onCall";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { leaveOn, newId } from "@/lib/staff/shifts";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { useActiveStaff } from "./tabActive";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Paid leave per person for the year, with the yearly allowance set here. */
export function BalancesPanel() {
  const employees = useActiveStaff((s) => s.employees);
  const timeOff = useActiveStaff((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  const allowance = useStaffPrefs((s) => s.ptoAllowance);
  const update = useStaffPrefs((s) => s.update);
  const year = Number(todayIso().slice(0, 4));
  const holidays = useMemo(
    () =>
      new Set(
        config.events
          .filter((e) => e.kind === "holiday" && e.date === e.endDate)
          .map((e) => e.date),
      ),
    [config.events],
  );
  const rows = employees
    .map((e) => ({ e, b: leaveBalance(e.id, timeOff, year, allowance, holidays) }))
    .sort(
      (a, b) =>
        a.b.remaining - b.b.remaining || displayName(a.e).localeCompare(displayName(b.e)),
    );
  return (
    <div className="flex flex-col gap-3" data-testid="balances-panel">
      <label className="text-ink-soft flex items-center gap-2 text-[13px]">
        Paid leave days a year
        <Input
          type="number"
          min={0}
          max={366}
          aria-label="Paid leave days a year"
          className="w-24"
          value={allowance}
          onChange={(e) =>
            update((p) => ({
              ...p,
              ptoAllowance: Math.max(0, Math.min(366, Number(e.target.value) || 0)),
            }))
          }
        />
        <span className="text-ink-muted text-[12px]">
          {year}; weekends and holidays on the roster do not count
        </span>
      </label>
      <ul
        aria-label="Leave balances"
        className="flex flex-col"
        data-testid="balances-list"
      >
        {rows.map(({ e, b }) => {
          const bar = balanceBar(b);
          return (
            <li
              key={e.id}
              data-testid="balance-row"
              className="border-line grid grid-cols-[minmax(110px,190px)_minmax(0,1fr)_auto] items-center gap-3 border-t py-2 text-[13px]"
            >
              <span className="text-ink truncate font-medium">{displayName(e)}</span>
              <span
                role="img"
                aria-label={`${b.used} used, ${b.pending} waiting, ${b.remaining} left of ${b.allowance}`}
                title={`${b.used} used, ${b.pending} waiting, ${b.remaining} left of ${b.allowance}`}
                className="bg-chip flex h-2.5 overflow-hidden rounded-full"
              >
                <span
                  className={bar.over ? "bg-red" : "bg-accent"}
                  style={{ width: `${bar.usedPct}%` }}
                />
                <span className="bg-amber/60" style={{ width: `${bar.pendingPct}%` }} />
              </span>
              <span className="flex w-[168px] items-baseline justify-end gap-2 whitespace-nowrap">
                <span className="text-ink-muted text-[12px]">
                  {b.used} used{b.pending ? ` · ${b.pending} waiting` : ""}
                </span>
                <span
                  className={`w-14 text-right font-bold ${b.remaining < 0 ? "text-red" : "text-ink"}`}
                >
                  {b.remaining} left
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-accent h-2.5 w-4 rounded-full" />
          Used
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-amber/60 h-2.5 w-4 rounded-full" />
          Waiting for approval
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-red h-2.5 w-4 rounded-full" />
          More than the allowance
        </span>
      </p>
    </div>
  );
}

/** Ask to swap two days between two people; approving applies both changes to the roster (marked as swaps). */
export function SwapsPanel() {
  const config = useRosterStore((s) => s.config);
  const assignments = useActiveStaff((s) => s.shifts);
  const commit = useStaffStore((s) => s.commit);
  const swaps = useStaffPrefs((s) => s.swaps);
  const update = useStaffPrefs((s) => s.update);
  const [form, setForm] = useState({
    memberA: "",
    dateA: todayIso(),
    memberB: "",
    dateB: todayIso(),
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => config.members.find((m) => m.id === id)?.name ?? "Unknown";

  const add = () => {
    const check = checkSwap(form, assignments);
    if (!check.ok) return setError(check.reason);
    setError(null);
    const swap: SwapRequest = {
      id: newId("sw"),
      ...form,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    update((p) => ({ ...p, swaps: [...p.swaps, swap] }));
  };

  const decide = async (s: SwapRequest, status: "approved" | "rejected") => {
    if (status === "approved") {
      const check = checkSwap(s, assignments);
      if (!check.ok) return toast({ tone: "danger", message: check.reason });
      const result = await commit("shifts", { upsert: swapAssignments(s, assignments) });
      if (!result.ok) return toast({ tone: "danger", message: result.reason });
    }
    update((p) => ({
      ...p,
      swaps: p.swaps.map((x) => (x.id === s.id ? { ...x, status } : x)),
    }));
    toast({
      tone: "success",
      message:
        status === "approved"
          ? "Swap approved and applied to the roster."
          : "Swap rejected.",
    });
  };

  const people = (
    <>
      <option value="">Choose…</option>
      {config.members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="swaps-panel">
      <div className="border-line rounded-card grid gap-2 border p-3 sm:grid-cols-2">
        <select
          aria-label="First person"
          className={SELECT}
          value={form.memberA}
          onChange={(e) => setForm({ ...form, memberA: e.target.value })}
        >
          {people}
        </select>
        <Input
          aria-label="Their day"
          type="date"
          value={form.dateA}
          onChange={(e) => setForm({ ...form, dateA: e.target.value })}
        />
        <select
          aria-label="Second person"
          className={SELECT}
          value={form.memberB}
          onChange={(e) => setForm({ ...form, memberB: e.target.value })}
        >
          {people}
        </select>
        <Input
          aria-label="Their other day"
          type="date"
          value={form.dateB}
          onChange={(e) => setForm({ ...form, dateB: e.target.value })}
        />
        <Input
          aria-label="Reason"
          className="sm:col-span-2"
          placeholder="Reason (optional)"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        {error && (
          <p className="text-red text-[12.5px] sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <Button
          className="justify-self-start sm:col-span-2"
          onClick={add}
          disabled={!form.memberA || !form.memberB}
        >
          Request swap
        </Button>
      </div>
      {swaps.length === 0 ? (
        <p className="text-ink-muted text-[13px]">No swap requests.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...swaps].reverse().map((s) => (
            <li
              key={s.id}
              data-testid="swap-row"
              className="border-line bg-card rounded-card flex flex-wrap items-center gap-3 border px-4 py-3 text-[13px]"
            >
              <span className="text-ink min-w-0 flex-1">
                {name(s.memberA)} {formatDate(s.dateA)} ⇄ {name(s.memberB)}{" "}
                {formatDate(s.dateB)}
                {s.reason ? ` (${s.reason})` : ""}
              </span>
              {s.status === "pending" ? (
                <span className="flex gap-1.5">
                  <Button size="sm" onClick={() => void decide(s, "approved")}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(s, "rejected")}
                  >
                    Reject
                  </Button>
                </span>
              ) : (
                <span className="text-ink-muted text-[12px] font-semibold">
                  {s.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A fair weekend and holiday on-call rotation from the people you tick; leave is respected. */
export function OnCallPanel() {
  const employees = useActiveStaff((s) => s.employees);
  const timeOff = useActiveStaff((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 55));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const people = useMemo(
    () => employees.filter((e) => !e.excludeFromShiftRoster),
    [employees],
  );
  const holidayList = useMemo(
    () => holidayDays(config.events, from, to),
    [config.events, from, to],
  );
  const days = onCallDays(from, to, holidayList);
  const chosen = people.filter((e) => picked.has(e.id));
  const plan = useMemo(
    () =>
      chosen.length === 0
        ? null
        : planOnCall(
            days,
            chosen.map((e) => ({
              id: e.id,
              name: displayName(e),
              unavailable: new Set(days.filter((d) => leaveOn(timeOff, e.id, d))),
            })),
          ),
    // `days` and `chosen` are derived from the inputs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, picked, employees, timeOff, config.events],
  );
  const nameOf = (id: string | null) => chosen.find((e) => e.id === id);
  return (
    <div className="flex flex-col gap-3" data-testid="oncall-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="From"
          type="date"
          className="w-44"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <Input
          aria-label="To"
          type="date"
          className="w-44"
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
        <span className="text-ink-muted text-[12px]">
          {days.length} weekend and holiday days
        </span>
      </div>
      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-auto">
        {people.map((e) => (
          <label key={e.id} className="text-ink-soft flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="accent-accent h-4 w-4"
              checked={picked.has(e.id)}
              onChange={() =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (!next.delete(e.id)) next.add(e.id);
                  return next;
                })
              }
            />
            {displayName(e)}
          </label>
        ))}
      </div>
      {plan && (
        <>
          <p className="text-ink-muted text-[12.5px]" data-testid="oncall-summary">
            {chosen.map((e) => `${displayName(e)} ${plan.counts[e.id]}`).join(" · ")}
            {plan.uncovered.length
              ? ` · ${plan.uncovered.length} day(s) nobody could take`
              : ""}
          </p>
          <ul className="flex flex-col gap-0.5 text-[13px]" data-testid="oncall-list">
            {plan.days.map((d) => (
              <li key={d.day} className="flex gap-3">
                <span className="text-ink-muted w-28">{formatDate(d.day)}</span>
                <span className={d.candidateId ? "text-ink" : "text-red"}>
                  {nameOf(d.candidateId)
                    ? displayName(nameOf(d.candidateId)!)
                    : "Nobody free"}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  "on-call.csv",
                  toCsv([
                    ["Date", "On call"],
                    ...plan.days.map((d) => [
                      d.day,
                      nameOf(d.candidateId) ? displayName(nameOf(d.candidateId)!) : "",
                    ]),
                  ]),
                  "text/csv",
                )
              }
            >
              Download CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  "on-call.ics",
                  buildIcs(
                    "On call",
                    plan.days
                      .filter((d) => d.candidateId)
                      .map((d) => ({
                        uid: `oc-${d.day}`,
                        date: d.day,
                        endDate: d.day,
                        summary: `On call: ${displayName(nameOf(d.candidateId)!)}`,
                      })),
                    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
                  ),
                  "text/calendar",
                )
              }
            >
              Download calendar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Public holidays by country from rules (fixed dates, Easter, "last Monday in May"). Lunar festivals are added by hand. */
export function HolidaysPanel() {
  const config = useRosterStore((s) => s.config);
  const save = useRosterStore((s) => s.save);
  const [country, setCountry] = useState<CountryId>("in");
  const [month, setMonth] = useState(monthStart(todayIso()));
  const year = Number(month.slice(0, 4));
  const preview = holidayEvents(country, year, config.events, () => newId("ev"));
  const weeks = useMemo(
    () => holidayMonth(month, config.events, preview),
    // `preview` is derived from the inputs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month, config.events, country],
  );
  const add = async () => {
    const result = await save({ ...config, events: [...config.events, ...preview] });
    toast(
      result.ok
        ? {
            tone: "success",
            message: `Added ${preview.length} holiday${preview.length === 1 ? "" : "s"}.`,
          }
        : { tone: "danger", message: result.reason },
    );
  };
  const today = todayIso();
  return (
    <div className="@container flex flex-col gap-3" data-testid="holidays-panel">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Country"
          className={SELECT}
          value={country}
          onChange={(e) => setCountry(e.target.value as CountryId)}
        >
          {COUNTRIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Input
          aria-label="Year"
          type="number"
          className="w-24"
          value={year}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (next >= 1900 && next <= 2200) setMonth(`${next}-${month.slice(5, 7)}-01`);
          }}
        />
        <Button onClick={() => void add()} disabled={preview.length === 0}>
          Add {preview.length} holiday{preview.length === 1 ? "" : "s"}
        </Button>
      </div>

      <section aria-label="Holiday calendar" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            aria-label="Previous month"
            size="sm"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <CaretLeftIcon weight="bold" />
          </IconButton>
          <h3 className="text-ink min-w-[130px] text-center text-[14px] font-bold">
            {formatMonth(month)}
          </h3>
          <IconButton
            aria-label="Next month"
            size="sm"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <CaretRightIcon weight="bold" />
          </IconButton>
          {month !== monthStart(today) && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(monthStart(today))}>
              This month
            </Button>
          )}
        </div>
        <table
          data-testid="holiday-calendar"
          className="border-line w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-[var(--radius-card)] border"
        >
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="bg-chip text-ink-muted px-2 py-1.5 text-left text-[11px] font-bold tracking-[0.06em] uppercase"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, i) => (
              <tr key={i}>
                {week.map((cell, j) =>
                  cell ? (
                    <td
                      key={cell.date}
                      className={cn(
                        "border-line h-[76px] border-t border-l p-1.5 align-top first:border-l-0",
                        j >= 5 && "bg-chip/50",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold",
                          cell.date === today
                            ? "bg-accent text-accent-contrast"
                            : "text-ink",
                        )}
                      >
                        {Number(cell.date.slice(8))}
                      </span>
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {cell.saved.map((label) => (
                          <li
                            key={`s-${label}`}
                            title={`${label} (in the calendar)`}
                            className="rh-hol truncate rounded-sm px-1.5 py-0.5 text-[10.5px] leading-tight font-semibold"
                          >
                            {label}
                          </li>
                        ))}
                        {cell.planned.map((label) => (
                          <li
                            key={`p-${label}`}
                            title={`${label} (will be added)`}
                            className="text-accent-ink border-accent/60 bg-accent-soft truncate rounded-sm border border-dashed px-1.5 py-0.5 text-[10.5px] leading-tight font-semibold"
                          >
                            {label}
                          </li>
                        ))}
                      </ul>
                    </td>
                  ) : (
                    <td
                      key={`pad-${i}-${j}`}
                      className="border-line bg-chip/30 border-t border-l first:border-l-0"
                    />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <span className="flex items-center gap-1.5">
            <span className="rh-hol h-3 w-5 rounded-sm" />
            Already in the calendar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="border-accent/60 bg-accent-soft h-3 w-5 rounded-sm border border-dashed" />
            Will be added
          </span>
        </p>
      </section>

      <ul className="text-[13px]" data-testid="holiday-preview">
        {preview.map((e) => (
          <li key={e.id} className="text-ink-soft">
            {formatDate(e.date)}: {e.label}
          </li>
        ))}
        {preview.length === 0 && (
          <li className="text-ink-muted">
            Everything for this year is already in the calendar.
          </li>
        )}
      </ul>
      <p className="text-ink-muted text-[12px]">
        Dates that follow the moon (Diwali, Eid and similar) change every year, so they
        are not guessed: add them in the roster&apos;s holiday list. Review the added days
        before relying on them.
      </p>
    </div>
  );
}

/** Roster and time off as a spreadsheet file (CSV opens in Excel) or a calendar file. */
export function ExportPanel() {
  const employees = useActiveStaff((s) => s.employees);
  const assignments = useActiveStaff((s) => s.shifts);
  const timeOff = useActiveStaff((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  const [from, setFrom] = useState(todayIso());
  const [days, setDays] = useState(28);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return (
    <div className="flex flex-col gap-3" data-testid="export-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Roster from"
          type="date"
          className="w-44"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <Input
          aria-label="Days"
          type="number"
          min={1}
          max={92}
          className="w-24"
          value={days}
          onChange={(e) =>
            setDays(Math.max(1, Math.min(92, Number(e.target.value) || 1)))
          }
        />
        <span className="text-ink-muted text-[12px]">days (up to 92)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            download(
              `roster-${from}.csv`,
              toCsv(rosterRows({ from, days, config, employees, assignments, timeOff })),
              "text/csv",
            )
          }
        >
          Roster (CSV, opens in Excel)
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            download("time-off.csv", toCsv(timeOffRows(timeOff, employees)), "text/csv")
          }
        >
          Time off (CSV, opens in Excel)
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            download(
              "time-off.ics",
              timeOffIcs(timeOff, employees, stamp),
              "text/calendar",
            )
          }
        >
          Approved time off (calendar)
        </Button>
      </div>
    </div>
  );
}
