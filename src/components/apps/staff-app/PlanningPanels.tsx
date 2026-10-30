"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { addDays, formatDate, todayIso } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import {
  buildIcs,
  rosterRows,
  timeOffIcs,
  timeOffRows,
  toCsv,
} from "@/lib/staff/exportFiles";
import { COUNTRIES, holidayEvents, type CountryId } from "@/lib/staff/holidayRules";
import {
  checkSwap,
  leaveBalance,
  swapAssignments,
  type SwapRequest,
} from "@/lib/staff/leave";
import { onCallDays, planOnCall } from "@/lib/staff/onCall";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { leaveOn, newId } from "@/lib/staff/shifts";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

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
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
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
      <table className="text-[13px]">
        <thead>
          <tr className="text-ink-muted text-left text-[12px]">
            <th className="py-1 pr-4 font-semibold">Person</th>
            <th className="py-1 pr-4 font-semibold">Used</th>
            <th className="py-1 pr-4 font-semibold">Waiting</th>
            <th className="py-1 font-semibold">Left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, b }) => (
            <tr key={e.id} className="border-line border-t" data-testid="balance-row">
              <td className="text-ink py-1 pr-4">{displayName(e)}</td>
              <td className="py-1 pr-4">{b.used}</td>
              <td className="py-1 pr-4">{b.pending || ""}</td>
              <td className={`py-1 ${b.remaining < 0 ? "text-red font-semibold" : ""}`}>
                {b.remaining}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ask to swap two days between two people; approving applies both changes to the roster (marked as swaps). */
export function SwapsPanel() {
  const config = useRosterStore((s) => s.config);
  const assignments = useStaffStore((s) => s.shifts);
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
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDays(todayIso(), 55));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const people = useMemo(
    () => employees.filter((e) => !e.excludeFromShiftRoster),
    [employees],
  );
  const holidayDays = config.events
    .filter((e) => e.kind === "holiday")
    .map((e) => e.date);
  const days = onCallDays(from, to, holidayDays);
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
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const preview = holidayEvents(country, year, config.events, () => newId("ev"));
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
  return (
    <div className="flex flex-col gap-3" data-testid="holidays-panel">
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
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
        <Button onClick={() => void add()} disabled={preview.length === 0}>
          Add {preview.length} holiday{preview.length === 1 ? "" : "s"}
        </Button>
      </div>
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
  const employees = useStaffStore((s) => s.employees);
  const assignments = useStaffStore((s) => s.shifts);
  const timeOff = useStaffStore((s) => s.timeOff);
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
          Roster (Excel / CSV)
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            download("time-off.csv", toCsv(timeOffRows(timeOff, employees)), "text/csv")
          }
        >
          Time off (Excel / CSV)
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
