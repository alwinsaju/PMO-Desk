"use client";

import { useMemo, useState } from "react";
import { CheckIcon, EnvelopeSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { canDecideLeave } from "@/lib/platform/profile";
import { buildMailto } from "@/lib/pmo/chaser";
import { breachText, leaveImpact, type CapacityInput } from "@/lib/staff/capacity";
import { formatRange, todayIso } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import { leaveBalance, leaveReply } from "@/lib/staff/leave";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffPrefs } from "@/lib/staff/staffPrefsStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { useActiveStaff } from "./tabActive";
import { dayCount, TIME_OFF_META } from "@/lib/staff/timeoff";
import type { TimeOffRequest } from "@/lib/staff/types";
import { PersonName } from "@/components/people/PersonName";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { useTemplateText } from "../templates-app/useTemplateText";

/** The shared inputs that capacity and leave logic read. */
export function useCapacityInput(): CapacityInput {
  const employees = useActiveStaff((s) => s.employees);
  const assignments = useActiveStaff((s) => s.shifts);
  const timeOff = useActiveStaff((s) => s.timeOff);
  const config = useRosterStore((s) => s.config);
  return useMemo(
    () => ({
      employees,
      members: config.members,
      groups: config.groups,
      schedules: config.schedules,
      assignments,
      timeOff,
    }),
    [employees, assignments, timeOff, config],
  );
}

/**
 * Leave requests waiting for a decision: approve or reject in one click, see whether approving would take a
 * team below its minimum, how much paid leave is left, and open a templated reply as an unsent mail. Used in
 * Staff and on the Dashboard.
 */
export function LeaveApprovals({ limit }: { limit?: number }) {
  const input = useCapacityInput();
  const commit = useStaffStore((s) => s.commit);
  const rules = useStaffPrefs((s) => s.coverage);
  const allowance = useStaffPrefs((s) => s.ptoAllowance);
  const canDecide = usePlatformPrefs((s) => canDecideLeave(s.profile));
  const [busy, setBusy] = useState<string | null>(null);
  const [replied, setReplied] = useState<Record<string, "approved" | "rejected">>({});
  const year = Number(todayIso().slice(0, 4));
  const me = useMyFirstName();
  const approvedText = useTemplateText("app:staff:leave-approved");
  const rejectedText = useTemplateText("app:staff:leave-rejected");

  const pending = input.timeOff
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit);

  const decide = async (r: TimeOffRequest, status: "approved" | "rejected") => {
    setBusy(r.id);
    const result = await commit("timeoff", {
      upsert: [{ ...r, status, decidedAt: new Date().toISOString() }],
    });
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "danger", message: result.reason });
      return;
    }
    setReplied((x) => ({ ...x, [r.id]: status }));
    toast({
      tone: "success",
      message: `${status === "approved" ? "Approved" : "Rejected"}. You can open a reply below.`,
    });
  };

  if (pending.length === 0 && Object.keys(replied).length === 0)
    return (
      <p className="text-ink-muted text-[13px]" data-testid="no-leave-requests">
        No leave requests are waiting.
      </p>
    );

  const shown = [
    ...pending,
    ...input.timeOff.filter((r) => replied[r.id] && !pending.some((p) => p.id === r.id)),
  ];

  return (
    <ul className="flex flex-col gap-2" data-testid="leave-approvals">
      {shown.map((r) => {
        const person = input.employees.find((e) => e.id === r.employeeId);
        const done = replied[r.id];
        const breaches = done ? [] : leaveImpact(r, input, rules);
        const balance = leaveBalance(r.employeeId, input.timeOff, year, allowance);
        const builtIn = person
          ? leaveReply(r, person.firstName, done ?? "approved", me)
          : null;
        const text = done === "rejected" ? rejectedText : approvedText;
        const reply =
          person && builtIn
            ? text.fill(
                {
                  first_name: person.firstName,
                  dates:
                    r.startDate === r.endDate
                      ? r.startDate
                      : `${r.startDate} to ${r.endDate}`,
                  type: r.type,
                  note: "",
                  my_name: me,
                },
                builtIn,
              )
            : null;
        const mail =
          person && reply && done
            ? buildMailto({
                to: person.deloitteEmail,
                subject: reply.subject,
                body: reply.body,
              })
            : null;
        return (
          <li
            key={r.id}
            data-testid="leave-request"
            className="border-line bg-card rounded-card flex flex-col gap-1.5 border px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-ink min-w-32 flex-1 text-[13.5px] font-semibold">
                {person ? (
                  <PersonName name={displayName(person)} employeeId={person.id} />
                ) : (
                  "Unknown"
                )}
              </span>
              <span className="text-ink-soft text-[12.5px]">
                {TIME_OFF_META[r.type].label} · {formatRange(r.startDate, r.endDate)} ·{" "}
                {dayCount(r).working} working day{dayCount(r).working === 1 ? "" : "s"}
              </span>
              {!done && !canDecide ? (
                <span className="text-ink-muted text-[12.5px]">
                  Waiting for a PMO lead to decide
                </span>
              ) : !done ? (
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    aria-label={`Approve ${person ? displayName(person) : "this request"}, ${formatRange(r.startDate, r.endDate)}`}
                    onClick={() => void decide(r, "approved")}
                  >
                    <CheckIcon size={13} weight="bold" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    aria-label={`Reject ${person ? displayName(person) : "this request"}, ${formatRange(r.startDate, r.endDate)}`}
                    onClick={() => void decide(r, "rejected")}
                  >
                    <XIcon size={13} weight="bold" />
                    Reject
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-2 text-[12.5px] font-semibold">
                  {done === "approved" ? "Approved" : "Rejected"}
                  {mail?.ok && (
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={mail.url}
                        onClick={() =>
                          (done === "rejected" ? rejectedText : approvedText).used()
                        }
                      >
                        <EnvelopeSimpleIcon size={13} />
                        Open reply (unsent)
                      </a>
                    </Button>
                  )}
                </span>
              )}
            </div>
            {r.reason && <p className="text-ink-muted text-[12px]">“{r.reason}”</p>}
            {r.type === "pto" && !done && (
              <p className="text-ink-muted text-[12px]">
                Paid leave this year: {balance.used} used, {balance.remaining} left of{" "}
                {balance.allowance}.
              </p>
            )}
            {breaches.length > 0 && (
              <p
                className="text-amber text-[12.5px] font-medium"
                data-testid="leave-breach"
              >
                {breachText(breaches)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
