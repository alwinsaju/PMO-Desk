"use client";

import { useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  ProhibitIcon,
  RobotIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import type { PtoMailRecord } from "@/lib/staff/ptoMail";
import { useStaffStore } from "@/lib/staff/staffStore";
import { TIME_OFF_META } from "@/lib/staff/timeoff";
import { TIME_OFF_TYPES, type TimeOffType } from "@/lib/staff/types";
import { postPtoMail, usePtoMail } from "./ptoMailApi";
import { Field, SELECT_CLASS, TonePill } from "./parts";

const CHOICES: readonly TimeOffType[] = TIME_OFF_TYPES.filter(
  (t) => t === "pto" || t === "comp-off" || t === "sick" || t === "other",
);

const STATUS_LABEL: Record<PtoMailRecord["status"], string> = {
  applied: "Filed",
  "needs-review": "Needs a look",
  ignored: "Ignored",
  dismissed: "Dismissed",
};
const STATUS_TONE = {
  applied: "success",
  "needs-review": "amber",
  ignored: "neutral",
  dismissed: "neutral",
} as const;

/** The PTO email flow at a glance: what arrived, what the AI filed, what needs a person. */
export function PtoMailPanel() {
  const { state, refresh } = usePtoMail();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!state) return null;
  const attention = state.needsReview;
  const quiet = state.records.length === 0 && state.waiting === 0;

  async function scan() {
    setBusy(true);
    await postPtoMail({ action: "scan" });
    await refresh();
    setBusy(false);
  }

  return (
    <section
      aria-label="PTO emails"
      className="border-line bg-card rounded-card mx-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border px-4 py-3"
    >
      <span className="bg-info-soft text-info grid h-9 w-9 shrink-0 place-items-center rounded-full">
        <EnvelopeSimpleIcon size={18} weight="bold" />
      </span>
      <div className="min-w-[220px] flex-1">
        <h3 className="text-ink text-[14px] font-bold">PTO emails</h3>
        <p className="text-ink-muted text-[12.5px]">
          {quiet
            ? "None yet. Once the Power Automate flow is running, PTO emails land here, the local AI reads each one and files the leave."
            : state.running
              ? "The local AI is reading new emails…"
              : state.waiting > 0
                ? `${state.waiting} ${state.waiting === 1 ? "email is" : "emails are"} waiting to be read.`
                : state.lastReceivedAt
                  ? `Last email received ${formatDate(state.lastReceivedAt.slice(0, 10))}. The leave it describes is filed as approved Time off.`
                  : "Emails are filed as approved Time off."}
        </p>
      </div>
      {attention > 0 && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <WarningCircleIcon size={15} weight="fill" className="text-amber" />
          {attention} {attention === 1 ? "email needs" : "emails need"} a look
        </Button>
      )}
      {state.records.length > 0 && attention === 0 && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          See what was filed
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || state.running}
        onClick={() => void scan()}
        title={`Looks in ${state.folder}`}
      >
        <ArrowClockwiseIcon
          size={14}
          weight="bold"
          className={cn(state.running && "animate-spin")}
        />
        Read now
      </Button>
      <PtoMailDialog
        open={open}
        onOpenChange={setOpen}
        records={state.records}
        onChange={refresh}
      />
    </section>
  );
}

function PtoMailDialog({
  open,
  onOpenChange,
  records,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  records: PtoMailRecord[];
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"review" | "recent">("review");
  const review = records.filter((r) => r.status === "needs-review");
  const recent = records.filter((r) => r.status !== "needs-review").slice(0, 30);
  const shown =
    tab === "review" && review.length === 0 && recent.length > 0 ? "recent" : tab;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogTitle>PTO emails</DialogTitle>
          <DialogDescription>
            The local AI reads each email and files PTO, comp off or sick leave for the
            sender. When it is not sure, the email waits here for you.
          </DialogDescription>
          <div
            role="group"
            aria-label="Show"
            className="bg-chip rounded-seg mt-4 inline-flex gap-0.5 p-0.5"
          >
            {(
              [
                ["review", `Needs a look (${review.length})`],
                ["recent", "Recently handled"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={shown === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-seg-item transition-ui h-7 px-3 text-[13px] font-semibold",
                  shown === value
                    ? "bg-field text-ink shadow-[0_2px_8px_rgba(30,30,60,0.12)]"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {shown === "review" ? (
            review.length === 0 ? (
              <p className="text-ink-muted mt-5 text-[13.5px]">Nothing needs a look.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {review.map((record) => (
                  <li key={record.id}>
                    <ReviewCard record={record} onChange={onChange} />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {recent.length === 0 && (
                <li className="text-ink-muted text-[13.5px]">Nothing yet.</li>
              )}
              {recent.map((record) => (
                <li
                  key={record.id}
                  className="border-line rounded-card border px-3.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TonePill tone={STATUS_TONE[record.status]}>
                      {STATUS_LABEL[record.status]}
                    </TonePill>
                    <span className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {record.subject || "(no subject)"}
                    </span>
                    <span className="text-ink-muted text-[12px]">
                      {record.senderName || record.senderAddress}
                    </span>
                  </div>
                  <p className="text-ink-muted mt-1 text-[12.5px]">
                    {record.reason}
                    {record.draft?.startDate &&
                      ` · ${formatDate(record.draft.startDate)}${record.draft.endDate && record.draft.endDate !== record.draft.startDate ? ` – ${formatDate(record.draft.endDate)}` : ""}`}
                    {record.draft?.type && ` · ${TIME_OFF_META[record.draft.type].label}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function ReviewCard({
  record,
  onChange,
}: {
  record: PtoMailRecord;
  onChange: () => Promise<void>;
}) {
  const employees = useStaffStore((s) => s.employees);
  const reload = useStaffStore((s) => s.load);
  const sorted = useMemo(
    () => [...employees].sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [employees],
  );
  const [employeeId, setEmployeeId] = useState(record.draft?.employeeId ?? "");
  const [type, setType] = useState<TimeOffType>(record.draft?.type ?? "pto");
  const [startDate, setStartDate] = useState(record.draft?.startDate ?? "");
  const [endDate, setEndDate] = useState(
    record.draft?.endDate ?? record.draft?.startDate ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await postPtoMail({ ...body, id: record.id });
    if (result.ok) {
      await Promise.all([onChange(), reload()]);
    } else {
      setError(result.reason);
    }
    setBusy(false);
  }

  const idBase = `pto-${record.id.replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
  const canFile = employeeId !== "" && startDate !== "" && endDate !== "";

  return (
    <article
      className="border-line bg-card rounded-card border p-4"
      aria-label={record.subject || "PTO email"}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <h4 className="text-ink min-w-0 flex-1 text-[14px] font-bold">
          {record.subject || "(no subject)"}
        </h4>
        <span className="text-ink-muted text-[12px]">
          {record.senderName || record.senderAddress} ·{" "}
          {formatDate(record.receivedAt.slice(0, 10))}
        </span>
      </div>
      {record.excerpt && (
        <blockquote className="border-line text-ink-soft bg-chip/60 mt-2 max-h-[110px] overflow-y-auto rounded-md border-l-2 px-3 py-2 text-[12.5px] whitespace-pre-line">
          {record.excerpt}
        </blockquote>
      )}
      <p className="text-amber mt-2 flex items-start gap-1.5 text-[12.5px] font-medium">
        <RobotIcon size={15} className="mt-px shrink-0" />
        {record.reason}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Person" htmlFor={`${idBase}-who`}>
          <select
            id={`${idBase}-who`}
            className={SELECT_CLASS}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Choose…</option>
            {sorted.map((e) => (
              <option key={e.id} value={e.id}>
                {displayName(e)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind of leave" htmlFor={`${idBase}-type`}>
          <select
            id={`${idBase}-type`}
            className={SELECT_CLASS}
            value={type}
            onChange={(e) => setType(e.target.value as TimeOffType)}
          >
            {CHOICES.map((t) => (
              <option key={t} value={t}>
                {TIME_OFF_META[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From" htmlFor={`${idBase}-from`}>
          <Input
            id={`${idBase}-from`}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="To (inclusive)" htmlFor={`${idBase}-to`}>
          <Input
            id={`${idBase}-to`}
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-red mt-2 text-[12.5px]">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void act({ action: "dismiss" })}
        >
          <ProhibitIcon size={14} />
          Not leave / dismiss
        </Button>
        <Button
          size="sm"
          disabled={busy || !canFile}
          onClick={() =>
            void act({ action: "apply", employeeId, type, startDate, endDate })
          }
        >
          <CheckCircleIcon size={14} weight="bold" />
          File as approved leave
        </Button>
      </div>
    </article>
  );
}
