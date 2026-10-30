"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Health = "unknown" | "ready" | "asleep" | "waking";

const POLL_MS = 4_000;
const GIVE_UP_MS = 4 * 60_000;

async function readLoaded(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/ai/runtime", { signal: AbortSignal.timeout(4_000) });
    const body = (await res.json()) as { modelLoaded?: boolean };
    return typeof body.modelLoaded === "boolean" ? body.modelLoaded : null;
  } catch {
    return null;
  }
}

/**
 * Shown above the command bar while it is focused and the local model is asleep: a cold
 * start takes minutes, so offer to wake it before the question is asked. Reads the status
 * each time the bar gets focus (no background polling) and polls only while waking.
 */
export function ModelHealthChip({ active }: { active: boolean }) {
  const [health, setHealth] = useState<Health>("unknown");
  const wakingSince = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void readLoaded().then((loaded) => {
      if (cancelled || loaded === null) return;
      setHealth((current) =>
        current === "waking" ? current : loaded ? "ready" : "asleep",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (health !== "waking") return;
    const id = setInterval(async () => {
      const loaded = await readLoaded();
      const started = wakingSince.current ?? Date.now();
      if (loaded) setHealth("ready");
      else if (Date.now() - started > GIVE_UP_MS) setHealth("asleep");
    }, POLL_MS);
    return () => clearInterval(id);
  }, [health]);

  const wake = async () => {
    wakingSince.current = Date.now();
    setHealth("waking");
    try {
      await fetch("/api/ai/runtime/load", { method: "POST" });
    } catch {
      setHealth("asleep");
    }
  };

  if (!active || (health !== "asleep" && health !== "waking")) return null;
  return (
    <p
      role="status"
      className={cn(
        "glass rounded-chip text-ink-soft pointer-events-auto flex items-center gap-2.5 px-3.5 py-1.5 text-[12.5px] font-semibold",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          health === "waking" ? "bg-amber animate-pulse" : "bg-ink-muted",
        )}
      />
      {health === "waking"
        ? "Waking the AI model… this can take a few minutes."
        : "The AI model is asleep."}
      {health === "asleep" && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void wake()}
          className="text-accent-ink hover:bg-chip rounded-control px-2 py-0.5"
        >
          Wake it now
        </button>
      )}
    </p>
  );
}
