"use client";

import { useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CalendarPlusIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRange, todayIso } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import {
  STATUS_META,
  TIME_OFF_META,
  dayCount,
  filterTimeOff,
  timeOffStats,
  validateTimeOff,
} from "@/lib/staff/timeoff";
import type { TimeOffRequest, TimeOffStatus } from "@/lib/staff/types";
import {
  ConfirmDialog,
  DASH,
  EmployeeAvatar,
  EmptyState,
  TONE_DOT,
  TonePill,
} from "./parts";
import { TimeOffDialog } from "./TimeOffDialog";

const STATUS_TABS: { value: TimeOffStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const CARD = "border-line bg-card rounded-card border";

export function TimeOffTab() {
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const commit = useStaffStore((s) => s.commit);

  const [status, setStatus] = useState<TimeOffStatus | "">("");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<TimeOffRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const ids = useMemo(() => new Set(byId.keys()), [byId]);
  const stats = useMemo(() => timeOffStats(timeOff, today), [timeOff, today]);
  const rows = useMemo(
    () => filterTimeOff(timeOff, byId, { status, query }),
    [timeOff, byId, status, query],
  );

  async function decide(request: TimeOffRequest, next: TimeOffStatus) {
    setError(null);
    const updated: TimeOffRequest = {
      ...request,
      status: next,
      decidedAt: next === "pending" ? "" : new Date().toISOString(),
    };
    const problem = validateTimeOff(updated, timeOff, ids);
    if (problem.startDate || problem.endDate) {
      return setError(problem.startDate ?? problem.endDate ?? null);
    }
    const result = await commit("timeoff", { upsert: [updated] });
    if (!result.ok) setError(result.reason);
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const result = await commit("timeoff", { remove: [deleting.id] });
    setBusy(false);
    if (result.ok) setDeleting(null);
    else setError(result.reason);
  }

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={<UsersThreeIcon size={26} />}
        title="Add people to track time off"
      >
        Time-off requests belong to people on the roster. Add employees in the Directory
        first.
      </EmptyState>
    );
  }

  const maxType = Math.max(1, ...stats.byType.map((t) => t.count));
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="grid gap-3 px-5 pb-4 @2xl:grid-cols-2">
        <section className={cn(CARD, "px-4 py-3.5")} aria-label="Approval status">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-ink text-[14px] font-bold">Approval status</h3>
            <span className="text-ink-muted text-[12px]">
              {stats.awayToday} away today
            </span>
          </div>
          <dl className="grid grid-cols-4 gap-3">
            {[
              ["Requested", stats.total, "text-ink"],
              ["Approved", stats.approved, "text-success"],
              ["Rejected", stats.rejected, "text-red"],
              ["Pending", stats.pending, "text-amber"],
            ].map(([label, value, tone]) => (
              <div key={label as string}>
                <dt className="text-ink-muted text-[12px]">{label}</dt>
                <dd className={cn("text-[26px] leading-tight font-bold", tone as string)}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={cn(CARD, "px-4 py-3.5")} aria-label="Time off by type">
          <h3 className="text-ink mb-3 text-[14px] font-bold">Time off request type</h3>
          <ul className="flex flex-col gap-2">
            {stats.byType.slice(0, 4).map(({ type, count }) => (
              <li key={type} className="flex items-center gap-3 text-[12.5px]">
                <span className="text-ink-soft w-[104px] shrink-0 truncate font-medium">
                  {TIME_OFF_META[type].label}
                </span>
                <span className="bg-chip h-2 flex-1 overflow-hidden rounded-full">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      TONE_DOT[TIME_OFF_META[type].tone],
                    )}
                    style={{ width: `${(count / maxType) * 100}%` }}
                  />
                </span>
                <span className="text-ink w-6 text-right font-bold">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div
          className="bg-chip rounded-seg inline-flex gap-0.5 p-1"
          role="group"
          aria-label="Filter by status"
        >
          {STATUS_TABS.map((tab) => {
            const count =
              tab.value === "" ? stats.total : stats[tab.value as TimeOffStatus];
            const active = status === tab.value;
            return (
              <button
                key={tab.label}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(tab.value)}
                className={cn(
                  "rounded-seg-item transition-ui h-7 px-3 text-[13px] font-semibold",
                  active
                    ? "bg-field text-ink shadow-[0_2px_8px_rgba(30,30,60,0.12)]"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {tab.label}{" "}
                <span className="text-ink-muted ml-0.5 text-[12px]">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto max-w-[240px] min-w-[160px] flex-1">
          <MagnifyingGlassIcon
            size={15}
            className="text-ink-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            aria-label="Search time off"
            placeholder="Search requests"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-9 text-[13px]"
          />
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <CalendarPlusIcon size={15} weight="bold" />
          Add time off
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-red flex items-start gap-2 px-5 pb-2 text-[13px]">
          <WarningCircleIcon size={16} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 pb-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={<CalendarPlusIcon size={26} />}
            title={
              timeOff.length === 0 ? "No time-off requests yet" : "No requests match"
            }
          >
            {timeOff.length === 0
              ? "Add a request to start tracking who is away and when."
              : "Try another status or search."}
          </EmptyState>
        ) : (
          <table className="border-line w-full border-separate border-spacing-0 overflow-hidden rounded-[var(--radius-card)] border text-left">
            <thead className="bg-chip text-ink-muted text-[11.5px] tracking-[0.06em] uppercase">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-bold">
                  Employee
                </th>
                <th scope="col" className="px-3 py-2.5 font-bold">
                  Type
                </th>
                <th scope="col" className="px-3 py-2.5 font-bold">
                  Dates
                </th>
                <th scope="col" className="hidden px-3 py-2.5 font-bold @3xl:table-cell">
                  Reason
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => {
                const person = byId.get(request.employeeId);
                const meta = TIME_OFF_META[request.type];
                const days = dayCount(request);
                return (
                  <tr key={request.id} className="border-line hover:bg-chip/60 group">
                    <td className="border-line border-t px-4 py-2.5">
                      {person ? (
                        <div className="flex min-w-0 items-center gap-2.5">
                          <EmployeeAvatar employee={person} size="sm" />
                          <span className="text-ink truncate text-[13.5px] font-semibold">
                            {displayName(person)}
                          </span>
                        </div>
                      ) : (
                        DASH
                      )}
                    </td>
                    <td className="border-line border-t px-3 py-2.5">
                      <TonePill tone={meta.tone}>{meta.label}</TonePill>
                    </td>
                    <td className="border-line text-ink border-t px-3 py-2.5 text-[13px]">
                      <span className="font-semibold whitespace-nowrap">
                        {formatRange(request.startDate, request.endDate)}
                      </span>
                      <span className="text-ink-muted block text-[12px]">
                        {days.working} working {days.working === 1 ? "day" : "days"}
                      </span>
                    </td>
                    <td
                      className="border-line text-ink-muted hidden max-w-[220px] truncate border-t px-3 py-2.5 text-[13px] @3xl:table-cell"
                      title={request.reason}
                    >
                      {request.reason || DASH}
                    </td>
                    <td className="border-line border-t px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {request.status === "pending" ? (
                          <>
                            <IconButton
                              aria-label={`Reject ${person ? displayName(person) : "request"}`}
                              variant="outline"
                              size="sm"
                              onClick={() => void decide(request, "rejected")}
                            >
                              <XIcon weight="bold" />
                            </IconButton>
                            <Button
                              size="sm"
                              onClick={() => void decide(request, "approved")}
                            >
                              <CheckIcon size={14} weight="bold" />
                              Approve
                            </Button>
                          </>
                        ) : (
                          <>
                            <TonePill tone={STATUS_META[request.status].tone}>
                              {STATUS_META[request.status].label}
                            </TonePill>
                            <IconButton
                              aria-label="Move back to pending"
                              title="Move back to pending"
                              size="sm"
                              onClick={() => void decide(request, "pending")}
                            >
                              <ArrowCounterClockwiseIcon />
                            </IconButton>
                          </>
                        )}
                        <IconButton
                          aria-label="Delete request"
                          size="sm"
                          className="hover:text-red"
                          onClick={() => {
                            setError(null);
                            setDeleting(request);
                          }}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <TimeOffDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this request?"
        description="It will be removed from the list and from the shift planner."
        confirmLabel="Delete"
        busy={busy}
        error={deleting ? error : null}
        onConfirm={() => void remove()}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </div>
  );
}
