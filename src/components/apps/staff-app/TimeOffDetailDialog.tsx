"use client";

import { useEffect, useState } from "react";
import { CheckIcon, EnvelopeSimpleIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui";
import { formatDate, formatRange } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import type { PtoKind, PtoMailRecord } from "@/lib/staff/ptoMail";
import { splitAroundQuote } from "@/lib/staff/ptoMailView";
import { STATUS_META, TIME_OFF_META, dayCount } from "@/lib/staff/timeoff";
import type { Employee, TimeOffRequest, TimeOffStatus } from "@/lib/staff/types";
import { TonePill } from "./parts";

const KIND_LABEL: Record<PtoKind, string> = {
  pto: "PTO",
  "comp-off": "Comp off",
  sick: "Sick leave",
  cancel: "Cancels earlier leave",
  "not-leave": "Not a leave request",
};

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

type Loaded =
  | { state: "loading" }
  | { state: "ready"; record: PtoMailRecord }
  | { state: "missing"; reason: string };

/** The email a request was filed from, as the app kept it. */
function useMailRecord(sourceId: string | undefined): Loaded {
  const [loaded, setLoaded] = useState<{ id: string; value: Loaded } | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    let live = true;
    fetch(`/api/staff/pto-mail/${encodeURIComponent(sourceId)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          record?: PtoMailRecord;
          reason?: string;
        } | null;
        if (!live) return;
        setLoaded({
          id: sourceId,
          value:
            body?.ok && body.record
              ? { state: "ready", record: body.record }
              : {
                  state: "missing",
                  reason: body?.reason ?? "The email could not be loaded.",
                },
        });
      })
      .catch(() => {
        if (live)
          setLoaded({
            id: sourceId,
            value: { state: "missing", reason: "The email could not be loaded." },
          });
      });
    return () => {
      live = false;
    };
  }, [sourceId]);
  return loaded && loaded.id === sourceId ? loaded.value : { state: "loading" };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-3 text-[13px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink min-w-0 break-words">{children}</dd>
    </div>
  );
}

function EmailText({ record }: { record: PtoMailRecord }) {
  if (record.text === undefined) {
    return (
      <p className="text-ink-muted text-[13px]">
        The text of this email was not kept (it was read before the app saved it).
      </p>
    );
  }
  const parts = splitAroundQuote(record.text, record.reading?.quote ?? "");
  return (
    <pre
      data-testid="email-text"
      className="bg-chip text-ink max-h-48 overflow-auto rounded-md p-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap"
    >
      {parts.map((part, i) =>
        part.quoted ? (
          <mark key={i} className="bg-amber/30 text-ink rounded px-0.5">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </pre>
  );
}

function EmailSection({ record }: { record: PtoMailRecord }) {
  const reading = record.reading;
  return (
    <>
      <section aria-labelledby="to-email" className="flex flex-col gap-2">
        <h3
          id="to-email"
          className="text-ink flex items-center gap-1.5 text-[13px] font-semibold"
        >
          <EnvelopeSimpleIcon size={15} aria-hidden /> The email
        </h3>
        <dl className="flex flex-col gap-1">
          <Row label="From">
            {record.senderName || record.senderAddress}
            {record.senderName && record.senderAddress
              ? ` <${record.senderAddress}>`
              : ""}
          </Row>
          <Row label="Received">{formatDate(record.receivedAt.slice(0, 10))}</Row>
          <Row label="Subject">{record.subject || "(no subject)"}</Row>
        </dl>
        <EmailText record={record} />
      </section>

      <section aria-labelledby="to-ai" className="flex flex-col gap-2">
        <h3
          id="to-ai"
          className="text-ink flex items-center gap-1.5 text-[13px] font-semibold"
        >
          <SparkleIcon size={15} aria-hidden /> What the AI read
        </h3>
        {reading ? (
          <dl className="flex flex-col gap-1">
            <Row label="Kind">{KIND_LABEL[reading.kind]}</Row>
            <Row label="Dates">
              {reading.startDate
                ? formatRange(reading.startDate, reading.endDate || reading.startDate)
                : "None found"}
              {reading.partialDay ? " (part of a day)" : ""}
            </Row>
            <Row label="Confidence">
              {CONFIDENCE_LABEL[reading.confidence]}
              {reading.confidence === "low" && " – check this one"}
            </Row>
            {reading.quote && <Row label="Evidence">“{reading.quote}”</Row>}
            {reading.reason && <Row label="Reason">{reading.reason}</Row>}
          </dl>
        ) : (
          <p className="text-ink-muted text-[13px]">
            The AI gave no reading for this email. {record.reason}
          </p>
        )}
      </section>
    </>
  );
}

export function TimeOffDetailDialog({
  request,
  person,
  onOpenChange,
  onDecide,
}: {
  request: TimeOffRequest | null;
  person: Employee | undefined;
  onOpenChange: (open: boolean) => void;
  onDecide: (request: TimeOffRequest, status: TimeOffStatus) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      {request && (
        <DialogContent className="max-w-xl">
          <Detail
            request={request}
            person={person}
            onClose={() => onOpenChange(false)}
            onDecide={onDecide}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Detail({
  request,
  person,
  onClose,
  onDecide,
}: {
  request: TimeOffRequest;
  person: Employee | undefined;
  onClose: () => void;
  onDecide: (request: TimeOffRequest, status: TimeOffStatus) => void;
}) {
  const fromEmail = request.source === "email";
  const mail = useMailRecord(fromEmail ? request.sourceId : undefined);
  const who = person ? displayName(person) : "this person";
  const meta = TIME_OFF_META[request.type];
  const status = STATUS_META[request.status];
  const days = dayCount(request);
  const decide = (next: TimeOffStatus) => {
    onDecide(request, next);
    onClose();
  };

  return (
    <>
      <DialogTitle>{who}&apos;s time off</DialogTitle>
      <DialogDescription>
        {fromEmail
          ? "Filed by the AI from a PTO email. Check it against the email before you decide."
          : "Added by hand."}
      </DialogDescription>

      <div className="mt-4 flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <section aria-labelledby="to-request" className="flex flex-col gap-2">
          <h3 id="to-request" className="text-ink text-[13px] font-semibold">
            The request
          </h3>
          <dl className="flex flex-col gap-1">
            <Row label="Type">{meta.label}</Row>
            <Row label="Dates">
              {formatRange(request.startDate, request.endDate)} · {days.working} working{" "}
              {days.working === 1 ? "day" : "days"}
            </Row>
            <Row label="Status">
              <TonePill tone={status.tone}>{status.label}</TonePill>
            </Row>
            {request.reason && <Row label="Note">{request.reason}</Row>}
          </dl>
        </section>

        {fromEmail && mail.state === "loading" && (
          <p className="text-ink-muted text-[13px]">Loading the email…</p>
        )}
        {fromEmail && mail.state === "missing" && (
          <p className="text-ink-muted text-[13px]" role="status">
            {mail.reason}
          </p>
        )}
        {fromEmail && mail.state === "ready" && <EmailSection record={mail.record} />}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {request.status === "pending" && (
          <>
            <Button variant="outline" onClick={() => decide("rejected")}>
              <XIcon size={14} weight="bold" />
              Reject
            </Button>
            <Button onClick={() => decide("approved")}>
              <CheckIcon size={14} weight="bold" />
              Approve
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
