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
  Input,
} from "@/components/ui";
import { todayIso } from "@/lib/staff/dates";
import { displayName, sortEmployees } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import {
  STATUS_META,
  TIME_OFF_META,
  createTimeOff,
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
  const [errors, setErrors] = useState<TimeOffErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof TimeOffRequest>(key: K, value: TimeOffRequest[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    const request: TimeOffRequest = {
      ...draft,
      reason: draft.reason.trim(),
      decidedAt: draft.status === "pending" ? "" : new Date().toISOString(),
    };
    const found = validateTimeOff(request, timeOff, ids);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    const result = await commit("timeoff", { upsert: [request] });
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
        <Field
          label="Employee"
          htmlFor="to-employee"
          error={errors.employeeId}
          className="sm:col-span-2"
        >
          <select
            id="to-employee"
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
        </Field>
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
        <Field label="From" htmlFor="to-start" error={errors.startDate}>
          <Input
            id="to-start"
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
        </Field>
        <Field label="To (inclusive)" htmlFor="to-end" error={errors.endDate}>
          <Input
            id="to-end"
            type="date"
            value={draft.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </Field>
        <Field label="Reason" htmlFor="to-reason" className="sm:col-span-2">
          <Input
            id="to-reason"
            maxLength={500}
            value={draft.reason}
            onChange={(e) => set("reason", e.target.value)}
            placeholder="Optional"
          />
        </Field>
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
