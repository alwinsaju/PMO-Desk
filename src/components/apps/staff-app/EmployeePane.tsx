"use client";

import { useState, Fragment, type ReactNode } from "react";
import {
  EnvelopeSimpleIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button, IconButton, Switch } from "@/components/ui";
import { formatDate, formatRange, relativeDays, todayIso } from "@/lib/staff/dates";
import { displayName, isAwaitingProfile, rollOffStatus } from "@/lib/staff/employees";
import { emailBreakParts } from "@/lib/staff/emailBreaks";
import { TIME_OFF_META, upcomingLeave } from "@/lib/staff/timeoff";
import { useStaffStore } from "@/lib/staff/staffStore";
import type { Employee } from "@/lib/staff/types";
import { ConfirmDialog, DASH, EmployeeAvatar, TonePill } from "./parts";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line border-t px-5 py-4 first:border-t-0">
      <h4 className="text-ink-muted mb-2.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        {title}
      </h4>
      <dl className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
        {children}
      </dl>
    </section>
  );
}

function Row({
  label,
  fromProfile,
  pending,
  children,
}: {
  label: string;
  /** This value normally comes from the M365 profile. */
  fromProfile?: boolean;
  /** The M365 profile has not arrived yet. */
  pending?: boolean;
  children: ReactNode;
}) {
  const empty = children === "" || children === null || children === undefined;
  return (
    <>
      <dt className="text-ink-muted pt-px text-[12.5px]">{label}</dt>
      <dd className="text-ink min-w-0 text-[13.5px] leading-snug font-semibold break-words">
        {empty ? (
          pending && fromProfile ? (
            <span className="text-ink-faint font-normal italic">Waiting for M365</span>
          ) : (
            DASH
          )
        ) : (
          children
        )}
      </dd>
    </>
  );
}

/** An address that wraps only after "@" or ".", so it is never cut mid-word. */
function Email({ address }: { address: string }) {
  return (
    <span className="[overflow-wrap:normal]" title={address}>
      {emailBreakParts(address).map((part, index) => (
        <Fragment key={index}>
          {part}
          <wbr />
        </Fragment>
      ))}
    </span>
  );
}

function RollOff({ date }: { date: string }) {
  const status = rollOffStatus(date, todayIso());
  return (
    <span className="flex flex-wrap items-center gap-2">
      {formatDate(date)}
      {status.kind !== "none" && status.kind !== "later" && (
        <TonePill tone={status.kind === "past" ? "red" : "amber"}>
          {status.kind === "past" ? "Rolled off" : relativeDays(status.days)}
        </TonePill>
      )}
    </span>
  );
}

export function EmployeePane({
  employee,
  onEdit,
  onDeleted,
  onClose,
}: {
  employee: Employee;
  onEdit: () => void;
  onDeleted: () => void;
  /** Closes the pane: on a narrow window it is a drawer over the list. */
  onClose: () => void;
}) {
  const commit = useStaffStore((s) => s.commit);
  const offboard = useStaffStore((s) => s.offboard);
  const requestProfile = useStaffStore((s) => s.requestProfile);
  const timeOff = useStaffStore((s) => s.timeOff);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = isAwaitingProfile(employee);
  const leave = upcomingLeave(timeOff, employee.id, todayIso()).slice(0, 3);
  const subtitle = [employee.level, employee.op].filter(Boolean).join(" · ");

  async function setIncluded(included: boolean) {
    setNotice(null);
    const result = await commit("employees", {
      upsert: [{ ...employee, excludeFromShiftRoster: !included }],
    });
    if (!result.ok) setNotice(result.reason);
  }

  async function askAgain() {
    setBusy(true);
    setNotice(null);
    const result = await requestProfile(employee.id);
    setBusy(false);
    setNotice(
      result.ok ? "Requested. The profile arrives once the flow has run." : result.reason,
    );
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await offboard([employee.id]);
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      onDeleted();
    } else {
      setError(result.reason);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex flex-col gap-4 px-5 pt-5 pb-4">
        <IconButton
          aria-label="Close details"
          size="sm"
          shape="round"
          onClick={onClose}
          className="absolute top-3 right-3"
        >
          <XIcon />
        </IconButton>
        <div className="flex items-center gap-4">
          <EmployeeAvatar employee={employee} size="xl" />
          <div className="min-w-0 pr-7">
            <h3 className="text-ink text-[19px] leading-tight font-bold break-words">
              {displayName(employee)}
            </h3>
            {subtitle && (
              <p className="text-ink-muted mt-0.5 text-[13px] break-words">{subtitle}</p>
            )}
            {pending && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TonePill tone="info">Waiting for M365 profile</TonePill>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[12px]"
                  disabled={busy}
                  onClick={() => void askAgain()}
                >
                  Request again
                </Button>
              </div>
            )}
            {!pending && employee.profileSync !== "pending" && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1.5 -ml-2 h-6 px-2 text-[12px]"
                disabled={busy}
                onClick={() => void askAgain()}
              >
                {employee.profileSync === "synced"
                  ? "Refresh from M365"
                  : "Get M365 profile"}
              </Button>
            )}
            {notice && (
              <p role="status" className="text-ink-muted mt-1.5 text-[12px]">
                {notice}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
            <PencilSimpleIcon size={14} weight="bold" />
            Edit info
          </Button>
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <a href={`mailto:${employee.deloitteEmail}`}>
              <EnvelopeSimpleIcon size={14} weight="bold" />
              Email
            </a>
          </Button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <Section title="Contact">
          <Row label="Deloitte email">
            {employee.deloitteEmail && <Email address={employee.deloitteEmail} />}
          </Row>
          <Row label="Takeda email">
            {employee.takedaEmail && <Email address={employee.takedaEmail} />}
          </Row>
          <Row label="Phone" fromProfile pending={pending}>
            {employee.phone}
          </Row>
        </Section>

        <Section title="Work">
          <Row label="Level" fromProfile pending={pending}>
            {employee.level}
          </Row>
          <Row label="Offering portfolio" fromProfile pending={pending}>
            {employee.op}
          </Row>
          <Row label="Offering">{employee.offering}</Row>
          <Row label="Team">{employee.team}</Row>
          <Row label="Client manager">{employee.clientManager}</Row>
          <Row label="Location">{employee.location}</Row>
          <Row label="Home office" fromProfile pending={pending}>
            {employee.homeOffice}
          </Row>
          <Row label="Milestone">{employee.milestone}</Row>
          <Row label="Campus recruit">{employee.campus ? "Yes" : "No"}</Row>
          <Row label="Shift roster">
            <span className="flex items-center gap-2.5">
              <Switch
                aria-label="Include in the shift roster"
                checked={!employee.excludeFromShiftRoster}
                onCheckedChange={(included) => void setIncluded(included)}
              />
              <span
                className={
                  employee.excludeFromShiftRoster
                    ? "text-ink-muted font-normal"
                    : "text-ink font-semibold"
                }
              >
                {employee.excludeFromShiftRoster ? "Excluded" : "Included"}
              </span>
            </span>
          </Row>
        </Section>

        <Section title="Engagement">
          <Row label="Roll-off">
            {employee.rollOffDate ? <RollOff date={employee.rollOffDate} /> : ""}
          </Row>
          <Row label="Staffit start">{formatDate(employee.staffitStartDate)}</Row>
          <Row label="Staffit end">{formatDate(employee.staffitEndDate)}</Row>
          <Row label="Contract end">{formatDate(employee.contractEndDate)}</Row>
        </Section>

        <Section title="Identifiers">
          <Row label="Person ID">{employee.deloittePersonId}</Row>
          <Row label="Network ID">{employee.networkId}</Row>
          <Row label="Workday ID">{employee.workdayId}</Row>
        </Section>

        <section className="border-line border-t px-5 py-4">
          <h4 className="text-ink-muted mb-2.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
            Skills
          </h4>
          {employee.skills.length === 0 ? (
            DASH
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {employee.skills.map((skill) => (
                <li
                  key={skill}
                  className="bg-chip text-ink-soft rounded-chip px-2.5 py-1 text-[12px] font-semibold"
                >
                  {skill}
                </li>
              ))}
            </ul>
          )}
        </section>

        {leave.length > 0 && (
          <section className="border-line border-t px-5 py-4">
            <h4 className="text-ink-muted mb-2.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
              Upcoming time off
            </h4>
            <ul className="flex flex-col gap-2">
              {leave.map((request) => (
                <li
                  key={request.id}
                  className="flex items-center justify-between gap-3 text-[13px]"
                >
                  <span className="text-ink font-semibold">
                    {formatRange(request.startDate, request.endDate)}
                  </span>
                  <TonePill tone={TIME_OFF_META[request.type].tone}>
                    {TIME_OFF_META[request.type].label}
                  </TonePill>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="border-line border-t px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-red"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            <TrashIcon size={14} weight="bold" />
            Remove from roster
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Remove ${displayName(employee)} from the roster?`}
        description="They will move to the Offboarded tab, where you can still edit their profile, restore them or delete them for good. Their shifts and time-off requests are dropped, and other apps will no longer see them."
        confirmLabel="Remove from roster"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onOpenChange={setConfirming}
      />
    </div>
  );
}
