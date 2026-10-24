"use client";

import { useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PmoState } from "@/lib/pmo/types";
import { scanNow } from "./api";
import { relativeTime } from "./queueView";

interface IngestStatusBarProps {
  state: PmoState;
  offline: boolean;
  onShowFiltered: () => void;
  onSettled: () => void;
}

const RUNTIME_DOT: Record<PmoState["runtime"]["state"], string> = {
  ready: "bg-accent",
  cold: "bg-neutral-400",
  stub: "bg-neutral-400",
  unknown: "bg-neutral-400",
  down: "bg-ink",
  "model-missing": "bg-ink",
};

/** One strip with everything about the intake pipeline: is the local model
 *  up, how many items were filtered, where the inbox is, and Scan now. Banners
 *  underneath explain anything that needs the user's attention. */
export function IngestStatusBar({
  state,
  offline,
  onShowFiltered,
  onSettled,
}: IngestStatusBarProps) {
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const { ingest, runtime, structuring } = state;
  const paused = structuring.paused;

  async function scan() {
    setScanning(true);
    setScanNote(null);
    try {
      const reply = await scanNow();
      if (reply.ok) {
        const { report } = reply;
        setScanNote(
          `${report.ingested} new, ${report.duplicates} duplicate, ${report.filtered} filtered`,
        );
      } else {
        setScanNote(reply.reason);
      }
      onSettled();
    } catch {
      setScanNote("Could not reach the app server.");
    } finally {
      setScanning(false);
    }
  }

  const modelText =
    paused?.code === "model-missing"
      ? "Model missing"
      : paused
        ? "Local model not running"
        : runtime.state === "ready"
          ? "Local model ready"
          : runtime.state === "cold"
            ? "Local model idle"
            : runtime.state === "stub"
              ? "Test stub"
              : runtime.state === "down"
                ? "Local model not running"
                : runtime.state === "model-missing"
                  ? "Model missing"
                  : "Local model unknown";

  return (
    <div className="border-border/60 flex flex-col border-b">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
        <span
          className="text-ink-muted flex items-center gap-1.5 text-[12px]"
          title={runtime.model ?? undefined}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              paused ? "bg-ink" : RUNTIME_DOT[runtime.state],
              structuring.active && "animate-pulse",
            )}
          />
          {modelText}
          {runtime.state === "cold" && !paused && runtime.message && (
            <span className="text-ink-faint">
              {" · "}
              {runtime.message}
            </span>
          )}
          {structuring.total > 0 && !paused && (
            <span className="text-ink-faint">
              {" · structuring "}
              {structuring.position} of {structuring.total}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={onShowFiltered}
          className="text-ink-muted hover:text-ink text-[12px] underline-offset-2 hover:underline"
        >
          {ingest.filteredCount} filtered
        </button>

        <span
          className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]"
          title={ingest.inboxDir}
        >
          {ingest.inboxDir}
        </span>

        <span className="text-ink-faint text-[11px]">
          {scanNote ??
            (ingest.lastScanAt
              ? `scanned ${relativeTime(ingest.lastScanAt, Date.parse(state.serverTime))}`
              : "not scanned yet")}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={scanning}
          onClick={() => void scan()}
        >
          <ArrowsClockwiseIcon
            size={13}
            weight="bold"
            className={scanning ? "animate-spin" : ""}
          />
          Scan now
        </Button>
      </div>

      {offline && (
        <Banner>
          Can&apos;t reach the AI OS server right now. Showing the last known state.
        </Banner>
      )}
      {paused && (
        <Banner strong>
          {paused.code === "model-missing" ? (
            <>
              {paused.message} Messages stay in the queue as pending and are structured
              once the model is installed.
            </>
          ) : (
            <>
              Local model not running.{" "}
              {structuring.waiting + (structuring.active ? 1 : 0) || "Some"} item(s) are
              waiting and stay pending; they are retried on every scan.
            </>
          )}
        </Banner>
      )}
      {!paused && runtime.state === "down" && <Banner strong>{runtime.message}</Banner>}
      {!paused && runtime.state === "model-missing" && (
        <Banner strong>{runtime.message}</Banner>
      )}
      {runtime.state === "stub" && <Banner>{runtime.message}</Banner>}
      {ingest.teamsFiltering && (
        <Banner>
          Teams items are being filtered until a tenant ID or chat is allowlisted. Add the
          tenant ID to <code className="font-mono">allowedTenantIds</code> in{" "}
          <code className="font-mono">{state.dataDir}\config.json</code>, or use “Allow
          this tenant” on a filtered Teams item.
        </Banner>
      )}
      {!ingest.inboxExists && ingest.lastScanAt && (
        <Banner strong>
          Inbox folder not found: <code className="font-mono">{ingest.inboxDir}</code>.
          Nothing can arrive until it exists.
        </Banner>
      )}
      {ingest.rejectedFileCount > 0 && (
        <Banner>
          {ingest.rejectedFileCount} producer file(s) could not be read and were parked in{" "}
          <code className="font-mono">rejected-files</code> with a reason.
        </Banner>
      )}
    </div>
  );
}

function Banner({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <p
      className={cn(
        "px-4 py-1.5 text-[12px]",
        strong ? "bg-ink text-ink-inverse" : "text-ink-muted bg-neutral-50",
      )}
    >
      {children}
    </p>
  );
}
