"use client";

import { useEffect, useState } from "react";
import { Tooltip } from "@/components/ui";
import { ModelLogDialog } from "@/components/ai-runtime";
import { useModelLog } from "@/components/ai-runtime/useModelLog";
import { cn } from "@/lib/cn";
import { modelChipOf, modelStateOf, type ModelChipTone } from "@/lib/ai-runtime/logView";

const DOT: Record<ModelChipTone, string> = {
  ready:
    "bg-success-dot shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success-dot)_22%,transparent)]",
  idle: "bg-ink-faint",
  waking:
    "bg-amber shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-amber)_20%,transparent)]",
  working:
    "bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
  off: "bg-red shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-red)_18%,transparent)]",
};

/** Ticks once a second while the model sits loaded, for the time left before it sleeps. */
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

/**
 * The local model's state next to the Time off list, where it reads PTO emails: asleep
 * when nothing needs it (the normal idle state; it frees its memory two minutes after
 * the last email), a countdown while it is loaded, and what it is doing while it works.
 * It only looks at the model, never wakes it; a click opens the model log.
 */
export function ModelChip() {
  const [open, setOpen] = useState(false);
  const { data } = useModelLog(true, false);
  const info = data.status ? modelStateOf(data.status, Date.now() + data.skewMs) : null;
  const now = useNow(Boolean(info?.unloadsAt), data.skewMs);
  if (!data.status || !info) return null;

  const chip = modelChipOf(info, now);
  const detail =
    info.state === "asleep"
      ? "The model is asleep to save memory. It wakes when a PTO email needs reading."
      : info.state === "ready"
        ? "The model is loaded and goes to sleep when nothing needs it."
        : chip.label;

  return (
    <>
      <Tooltip label={`${detail} Click to see what the model is doing.`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`PTO email reader: ${chip.label}. Click to see what the model is doing.`}
          className="text-ink-soft hover:text-ink rounded-chip focus-visible:ring-focus flex h-8 cursor-pointer items-center gap-2 px-2 text-[12.5px] font-semibold outline-none focus-visible:ring-2"
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              DOT[chip.tone],
              chip.busy && "motion-safe:animate-blink",
            )}
          />
          <span className="text-ink-muted font-normal">PTO emails ·</span>
          <span className="truncate">{chip.label}</span>
        </button>
      </Tooltip>
      <ModelLogDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
