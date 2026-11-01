"use client";

import type { ComponentType } from "react";
import {
  AirplaneTiltIcon,
  ArrowCounterClockwiseIcon,
  BabyIcon,
  CalendarBlankIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  DotsThreeCircleIcon,
  EnvelopeSimpleIcon,
  FlagIcon,
  ThermometerIcon,
  TrashIcon,
  XIcon,
  type IconProps,
} from "@phosphor-icons/react";
import { Button, IconButton, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { rowEnterClass, rowEnterStyle } from "@/lib/motion";
import { useChangeCount } from "@/lib/useChangeCount";
import { formatRange } from "@/lib/staff/dates";
import { displayName } from "@/lib/staff/employees";
import { STATUS_META, TIME_OFF_META, dayCount } from "@/lib/staff/timeoff";
import { overlappingLeave, type LeavePeer } from "@/lib/staff/timeoffView";
import type {
  Employee,
  TimeOffRequest,
  TimeOffStatus,
  TimeOffType,
} from "@/lib/staff/types";
import { EmployeeAvatar, TONE_DOT, TONE_PILL, TonePill } from "./parts";

const TYPE_ICON: Record<TimeOffType, ComponentType<IconProps>> = {
  pto: AirplaneTiltIcon,
  sick: ThermometerIcon,
  "public-holiday": FlagIcon,
  "comp-off": ClockCounterClockwiseIcon,
  parental: BabyIcon,
  other: DotsThreeCircleIcon,
};

const MAX_PEERS = 4;

/** Who else is out on the same days, so a decision is made with the cover in view. */
function OverlapStrip({
  peers,
  pending,
}: {
  peers: readonly LeavePeer[];
  pending: boolean;
}) {
  if (peers.length === 0) {
    return pending ? (
      <p className="text-ink-muted text-[12px]">No one else is out on these dates.</p>
    ) : null;
  }
  const shown = peers.slice(0, MAX_PEERS);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="overlap-strip">
      <span className="text-ink-muted text-[12px] font-semibold">
        Also out ({peers.length})
      </span>
      {shown.map((peer) => (
        <span
          key={peer.requestId}
          title={`${peer.name}: ${formatRange(peer.start, peer.end)} (${peer.status})`}
          className="bg-chip text-ink-soft rounded-chip inline-flex h-6 max-w-[220px] items-center gap-1.5 px-2.5 text-[12px] leading-none font-medium"
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              peer.status === "pending" ? "bg-amber" : "bg-success-dot",
            )}
          />
          <span className="truncate">{peer.name}</span>
          <span className="text-ink-muted shrink-0">
            {formatRange(peer.start, peer.end)}
          </span>
          <span className="sr-only">, {peer.status}</span>
        </span>
      ))}
      {peers.length > shown.length && (
        <span className="text-ink-muted text-[12px]">+{peers.length - shown.length}</span>
      )}
    </div>
  );
}

export function TimeOffCard({
  index,
  request,
  person,
  all,
  people,
  onOpen,
  onDecide,
  onDelete,
}: {
  /** Position in the list, for the staggered entrance. */
  index: number;
  request: TimeOffRequest;
  person: Employee | undefined;
  all: readonly TimeOffRequest[];
  people: ReadonlyMap<string, Employee>;
  onOpen: (request: TimeOffRequest) => void;
  onDecide: (request: TimeOffRequest, status: TimeOffStatus) => void;
  onDelete: (request: TimeOffRequest) => void;
}) {
  const who = person ? displayName(person) : "this person";
  const meta = TIME_OFF_META[request.type];
  const status = STATUS_META[request.status];
  const days = dayCount(request);
  const TypeIcon = TYPE_ICON[request.type];
  const pending = request.status === "pending";
  const peers =
    request.status === "rejected" ? [] : overlappingLeave(request, all, people);

  const flash = useChangeCount(request.status);

  return (
    <li
      data-testid="timeoff-card"
      data-status={request.status}
      style={rowEnterStyle(index)}
      className={cn(
        "border-line bg-card rounded-card relative flex overflow-hidden border",
        rowEnterClass(index),
      )}
    >
      {flash > 0 && (
        <span
          key={flash}
          aria-hidden
          className="anim-flash bg-accent-soft pointer-events-none absolute inset-0"
        />
      )}
      <span
        aria-hidden
        className={cn("w-1.5 shrink-0", TONE_DOT[status.tone])}
        title={status.label}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Open ${who}'s ${meta.label} request, ${formatRange(request.startDate, request.endDate)}`}
          onClick={() => onOpen(request)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(request);
            }
          }}
          className="focus-visible:ring-accent -m-1 flex min-w-0 flex-1 basis-[260px] cursor-pointer flex-col gap-2 rounded-md p-1 outline-none focus-visible:ring-2"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {person ? (
              <EmployeeAvatar employee={person} size="sm" />
            ) : (
              <span className="bg-chip h-7 w-7 shrink-0 rounded-full" aria-hidden />
            )}
            <span className="text-ink truncate text-[14px] font-semibold">{who}</span>
            {request.source === "email" && (
              <EnvelopeSimpleIcon
                size={14}
                aria-label="Filed from a PTO email"
                role="img"
                className="text-info shrink-0"
              />
            )}
            {!pending && <TonePill tone={status.tone}>{status.label}</TonePill>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-chip inline-flex h-6 items-center gap-1.5 px-2.5 text-[12px] leading-none font-semibold",
                TONE_PILL[meta.tone],
              )}
            >
              <TypeIcon size={13} weight="bold" aria-hidden />
              {meta.label}
            </span>
            <span className="border-line-strong text-ink rounded-chip inline-flex h-6 items-center gap-1.5 border px-2.5 text-[12px] leading-none font-semibold whitespace-nowrap">
              <CalendarBlankIcon size={13} weight="bold" aria-hidden />
              {formatRange(request.startDate, request.endDate)}
            </span>
            <span className="text-ink-muted text-[12px]">
              {days.working} working {days.working === 1 ? "day" : "days"}
            </span>
          </div>
          {request.reason && (
            <Tooltip
              label={request.reason}
              className="max-w-xs break-words whitespace-normal"
            >
              <p className="text-ink-soft truncate text-[13px]">{request.reason}</p>
            </Tooltip>
          )}
          <OverlapStrip peers={peers} pending={pending} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {pending ? (
            <>
              <Button
                variant="outline"
                aria-label={`Reject ${who}'s request`}
                onClick={() => onDecide(request, "rejected")}
              >
                <XIcon size={14} weight="bold" />
                Reject
              </Button>
              <Button
                aria-label={`Approve ${who}'s request`}
                onClick={() => onDecide(request, "approved")}
              >
                <CheckIcon size={14} weight="bold" />
                Approve
              </Button>
            </>
          ) : (
            <IconButton
              aria-label={`Move ${who}'s request back to pending`}
              tooltip="Move back to pending"
              size="sm"
              onClick={() => onDecide(request, "pending")}
            >
              <ArrowCounterClockwiseIcon />
            </IconButton>
          )}
          <IconButton
            aria-label={`Delete ${who}'s request`}
            tooltip="Delete (you can undo it)"
            size="sm"
            className="hover:text-red"
            onClick={() => onDelete(request)}
          >
            <TrashIcon />
          </IconButton>
        </div>
      </div>
    </li>
  );
}
