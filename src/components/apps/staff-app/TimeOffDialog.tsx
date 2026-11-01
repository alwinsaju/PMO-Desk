"use client";

import { useMemo, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
} from "@/components/ui";
import { formatDate, formatRange, todayIso } from "@/lib/staff/dates";
import { parseDateList } from "@/lib/staff/leave";
import { displayName, sortEmployees } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import {
  STATUS_META,
  TIME_OFF_META,
  createTimeOff,
  newRequestId,
  validateTimeOff,
  type TimeOffErrors,
} from "@/lib/staff/timeoff";
import {
  TIME_OFF_STATUSES,
  TIME_OFF_TYPES,
  type TimeOffRequest,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/staff/types";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { Field, SELECT_CLASS } from "./parts";

export function TimeOffDialog({
  open,
  defaultEmployeeId,
  onOpenChange,
}: {
  open: boolean;
  defaultEmployeeId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-w-lg">
          <TimeOffForm
            defaultEmployeeId={defaultEmployeeId}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TimeOffForm({
  defaultEmployeeId,
  onClose,
}: {
  defaultEmployeeId?: string;
  onClose: () => void;
}) {
  const employees = useStaffStore((s) => s.employees);
  const timeOff = useStaffStore((s) => s.timeOff);
  const commit = useStaffStore((s) => s.commit);
  const people = useMemo(() => sortEmployees(employees, "name"), [employees]);
  const ids = useMemo(() => new Set(employees.map((e) => e.id)), [employees]);

  const [draft, setDraft] = useState<TimeOffRequest>(() =>
    createTimeOff({
      employeeId: defaultEmployeeId ?? "",
      startDate: todayIso(),
      endDate: todayIso(),
    }),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof TimeOffRequest>(key: K, value: TimeOffRequest[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Several dates pasted at once ("5–7 Nov, 12 Nov"): one request per range.
  const [pasted, setPasted] = useState("");
  const parsed = useMemo(() => (pasted.trim() ? parseDateList(pasted) : null), [pasted]);
  const ranges = parsed?.ranges ?? [];

  // From and To are ignored while dates are typed in the list, so only the employee is checked then.
  const found = useMemo(
    () => validateTimeOff(draft, timeOff, ids),
    [draft, timeOff, ids],
  );
  const errors: TimeOffErrors =
    ranges.length > 0 ? { employeeId: found.employeeId } : found;

  async function save() {
    setSubmitted(true);
    setError(null);
    if (parsed && parsed.unreadable.length > 0)
      return setError(`Could not read: ${parsed.unreadable.join(", ")}`);
    if (Object.keys(errors).length > 0) return;
    const base: TimeOffRequest = {
      ...draft,
      reason: draft.reason.trim(),
      decidedAt: draft.status === "pending" ? "" : new Date().toISOString(),
    };
    const requests: TimeOffRequest[] =
      ranges.length > 0
        ? ranges.map((r) =>
            createTimeOff({
              ...base,
              id: newRequestId(),
              startDate: r.start,
              endDate: r.end,
            }),
          )
        : [base];
    for (let i = 0; i < requests.length; i++) {
      const more = validateTimeOff(
        requests[i],
        [...timeOff, ...requests.slice(0, i)],
        ids,
      );
      if (Object.keys(more).length > 0)
        return setError(
          `${formatDate(requests[i].startDate)}: ${Object.values(more)[0] ?? "this request is not valid."}`,
        );
    }
    setBusy(true);
    const result = await commit("timeoff", { upsert: requests });
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogTitle>Add time off</DialogTitle>
      <DialogDescription>
        Approved time off shows on the shift planner and keeps that person out of the
        day&apos;s coverage.
      </DialogDescription>

      <div className="mt-5 grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
        <FormField
          label="Employee"
          error={errors.employeeId}
          showErrorNow={submitted}
          className="sm:col-span-2"
        >
          {(control) => (
            <select
              {...control}
              className={SELECT_CLASS}
              value={draft.employeeId}
              onChange={(e) => set("employeeId", e.target.value)}
            >
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {displayName(p)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <Field label="Type" htmlFor="to-type">
          <select
            id="to-type"
            className={SELECT_CLASS}
            value={draft.type}
            onChange={(e) => set("type", e.target.value as TimeOffType)}
          >
            {TIME_OFF_TYPES.map((t) => (
              <option key={t} value={t}>
                {TIME_OFF_META[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="to-status">
          <select
            id="to-status"
            className={SELECT_CLASS}
            value={draft.status}
            onChange={(e) => set("status", e.target.value as TimeOffStatus)}
          >
            {TIME_OFF_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </Field>
        <FormField label="From" error={errors.startDate} showErrorNow={submitted}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={draft.startDate}
              onChange={(e) => {
                const start = e.target.value;
                setDraft((d) => ({
                  ...d,
                  startDate: start,
                  endDate: d.endDate < start ? start : d.endDate,
                }));
              }}
            />
          )}
        </FormField>
        <FormField label="To (inclusive)" error={errors.endDate} showErrorNow={submitted}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={draft.endDate}
              onChange={(e) => set("endDate", e.target.value)}
            />
          )}
        </FormField>
        <Field label="Reason" htmlFor="to-reason" className="sm:col-span-2">
          <Input
            id="to-reason"
            maxLength={500}
            value={draft.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <FormField
          label="Several dates at once"
          hint="Optional. Type dates or ranges separated by commas, for example 5–7 Nov, 12 Nov. One request is added for each, and From and To are ignored."
          className="sm:col-span-2"
        >
          {(control) => (
            <>
              <Input
                {...noSpellcheck}
                {...control}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="5–7 Nov, 12 Nov"
              />
              {parsed && (
                <p className="text-ink-muted text-[12px]" data-testid="pasted-dates">
                  {ranges.length > 0
                    ? `${ranges.length} request${ranges.length === 1 ? "" : "s"}: ${ranges
                        .map((r) => formatRange(r.start, r.end))
                        .join(", ")}`
                    : "No dates found yet."}
                  {parsed.unreadable.length > 0
                    ? ` Could not read: ${parsed.unreadable.join(", ")}.`
                    : ""}
                </p>
              )}
            </>
          )}
        </FormField>
      </div>

      {error && (
        <p role="alert" className="text-red mt-4 flex items-start gap-2 text-[13px]">
          <WarningCircleIcon size={16} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Add request
        </Button>
      </DialogFooter>
    </form>
  );
}
