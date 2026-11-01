"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownIcon, LightningIcon } from "@phosphor-icons/react";
import { Badge, Button, type BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MEMORY_SIZE, formatBytes } from "@/lib/format";
import {
  formatKeepAlive,
  modelStateOf,
  taskNoun,
  unloadCountdown,
  type ModelState,
} from "@/lib/ai-runtime/logView";
import type { AiRuntimeStatus } from "@/lib/ai-runtime/types";

const STATE_BADGE: Record<
  ModelState,
  { variant: BadgeVariant; label: string; pulse?: boolean }
> = {
  asleep: { variant: "neutral", label: "Asleep" },
  loading: { variant: "warning", label: "Waking up", pulse: true },
  working: { variant: "accent", label: "Working", pulse: true },
  ready: { variant: "success", label: "Loaded" },
  down: { variant: "danger", label: "Ollama not running" },
  "model-missing": { variant: "danger", label: "Not installed" },
};

/** Ticks once a second while there is a deadline, so the countdown is live
 *  between the dialog's 2 s polls. Only this small piece re-renders. */
function useNow(active: boolean, skewMs: number): number {
  const [now, setNow] = useState(() => Date.now() + skewMs);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now() + skewMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, skewMs]);
  return now;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-ink min-w-0 text-[13px] leading-snug break-words">
        {children}
      </dd>
    </div>
  );
}

export interface ModelStatusCardProps {
  status: AiRuntimeStatus | null;
  /** Server clock minus this browser's clock. */
  skewMs: number;
  busy: boolean;
  note: string | null;
  onLoad: () => void;
  onUnload: () => void;
}

/**
 * The header card of the model log: what state the model is in, what it holds,
 * when it goes away, and the Load now / Unload now buttons. Everything comes from
 * one status snapshot, so it never disagrees with the log under it.
 */
export function ModelStatusCard({
  status,
  skewMs,
  busy,
  note,
  onLoad,
  onUnload,
}: ModelStatusCardProps) {
  const info = status ? modelStateOf(status, Date.now() + skewMs) : null;
  const now = useNow(Boolean(info?.unloadsAt), skewMs);

  if (!status || !info) {
    return (
      <div className="border-line bg-card rounded-card text-ink-muted border p-4 text-[13px]">
        Checking the local model…
      </div>
    );
  }

  const badge = STATE_BADGE[info.state];
  // The deadline means something only while the model sits idle in memory; a
  // working model is not unloaded under its call.
  const countdown = info.state === "ready" ? unloadCountdown(info.unloadsAt, now) : null;
  const waiting = status.queue.waiting + (status.queue.active ? 1 : 0);
  const canUnload = info.state === "ready";
  const canLoad =
    info.state === "asleep" || (info.state === "down" && status.canAutoStart);

  return (
    <section
      aria-label="Model status"
      className="border-line bg-card rounded-card flex flex-col gap-3 border p-3.5 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-ink min-w-0 truncate text-[15px] font-bold">
          {status.defaultModel}
        </span>
        <Badge variant={badge.variant} dot pulse={badge.pulse}>
          {info.state === "working" ? `Working on ${taskNoun(info.task)}` : badge.label}
        </Badge>
        <div className="ml-auto flex shrink-0 flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canLoad || busy}
            onClick={onLoad}
            title="Wake the model now instead of when the next message needs it"
          >
            <LightningIcon size={14} weight="bold" />
            Load now
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canUnload || busy}
            onClick={onUnload}
            title={
              info.state === "working" || info.state === "loading"
                ? "Not while the model is working"
                : "Free the model's memory now"
            }
          >
            <ArrowDownIcon size={14} weight="bold" />
            Unload now
          </Button>
        </div>
      </div>

      {status.modelNote && (
        <p className="text-ink-muted text-[13px]">{status.modelNote}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Memory held">
          {info.sizeBytes > 0
            ? `${formatBytes(info.sizeBytes, MEMORY_SIZE)} (as Ollama reports it)`
            : info.state === "down"
              ? "unknown"
              : "none (asleep)"}
        </Fact>
        <Fact label="Unloads in">
          {countdown
            ? `${countdown} if idle`
            : info.state === "working" || info.state === "loading"
              ? "after the work finishes"
              : info.sizeBytes > 0
                ? "stays loaded"
                : "nothing to unload"}
        </Fact>
        <Fact label="Queue">
          {waiting === 0
            ? "empty"
            : `${status.queue.active ? "1 running" : "none running"}, ${status.queue.waiting} waiting`}
        </Fact>
        <Fact label="Ollama">
          {!status.running
            ? "not running"
            : status.ownedByUs
              ? status.adopted
                ? "taken over from an earlier PMO Desk session (stopped on quit)"
                : "started by PMO Desk (stopped on quit)"
              : "shared, already running (never stopped by PMO Desk)"}
          {status.version ? ` · ${status.version}` : ""}
        </Fact>
        <Fact label="Keep-alive">
          {formatKeepAlive(status.keepAlive)} after the last request
        </Fact>
        <Fact label="Load at launch">
          {status.prewarm ? "on" : "off (loads on demand)"}
        </Fact>
      </dl>

      {/* Always rendered (so a screen reader announces it), but takes no room until
          there is something to say. */}
      <p
        role="status"
        aria-live="polite"
        className={cn("text-ink-muted text-[12px]", !note && "sr-only")}
      >
        {note}
      </p>
    </section>
  );
}
