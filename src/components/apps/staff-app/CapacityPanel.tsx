"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { coverageGaps, capacityOn } from "@/lib/staff/capacity";
import { addDays, formatDate, todayIso } from "@/lib/staff/dates";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useCapacityInput } from "./LeaveApprovals";
import { LeaveApprovals } from "./LeaveApprovals";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

/** Who is working per team on a day, minimum-cover rules per team, and the days that fall short. */
export function CapacityPanel() {
  const input = useCapacityInput();
  const rules = useStaffPrefs((s) => s.coverage);
  const update = useStaffPrefs((s) => s.update);
  const [day, setDay] = useState(todayIso());
  const caps = capacityOn(day, input);
  const gaps = coverageGaps(todayIso(), 28, input, rules);

  const setRule = (groupId: string, value: number) =>
    update((p) => {
      const next = { ...p.coverage };
      if (value > 0) next[groupId] = value;
      else delete next[groupId];
      return { ...p, coverage: next };
    });

  return (
    <div className="flex flex-col gap-5" data-testid="capacity-panel">
      <div className="flex items-center gap-2">
        <label className="text-ink-soft text-[13px] font-semibold" htmlFor="cap-day">
          Day
        </label>
        <Input
          id="cap-day"
          type="date"
          value={day}
          className="w-44"
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={() => setDay(addDays(day, -1))}>
          Previous
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDay(addDays(day, 1))}>
          Next
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {caps.map((c) => {
          const need = rules[c.groupId] ?? 0;
          const short = need > 0 && c.working + c.onLeave > 0 && c.working < need;
          return (
            <div
              key={c.groupId}
              data-testid="capacity-card"
              className="border-line bg-card rounded-card flex flex-col gap-1.5 border px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-ink text-[13.5px] font-semibold">{c.name}</p>
                <p
                  className={`rounded-chip px-2 py-0.5 text-[12px] font-bold ${short ? "bg-red-soft text-red" : "bg-chip text-ink-soft"}`}
                >
                  {c.working} working{c.onLeave ? ` · ${c.onLeave} on leave` : ""}
                </p>
              </div>
              <p className="text-ink-muted text-[12px]">
                {c.byShift.length
                  ? c.byShift.map((s) => `${s.label} ${s.count}`).join(" · ")
                  : "Nobody is scheduled this day."}
              </p>
              <label className="text-ink-soft flex items-center gap-2 text-[12.5px]">
                Minimum per day
                <select
                  aria-label={`Minimum people: ${c.name}`}
                  className={SELECT}
                  value={need}
                  onChange={(e) => setRule(c.groupId, Number(e.target.value))}
                >
                  <option value={0}>No rule</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </div>

      <section aria-label="Coverage gaps" className="flex flex-col gap-1.5">
        <h3 className="text-ink text-[14px] font-bold">Next four weeks</h3>
        {gaps.length === 0 ? (
          <p className="text-ink-muted text-[13px]" data-testid="no-gaps">
            {Object.keys(rules).length === 0
              ? "Set a minimum for a team above to see where cover falls short."
              : "Every team meets its minimum."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="gap-list">
            {gaps.slice(0, 30).map((g) => (
              <li key={`${g.day}-${g.groupId}`} className="text-red text-[13px]">
                {formatDate(g.day)}: {g.name} has {g.have}, needs {g.need}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Leave waiting" className="flex flex-col gap-2">
        <h3 className="text-ink text-[14px] font-bold">Leave waiting for a decision</h3>
        <LeaveApprovals />
      </section>
    </div>
  );
}
