"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ENGINE_RESTARTED_EVENT } from "@/lib/engineRestart";
import { requestEngineStart } from "./engineBanner";
import { setEngineUrl } from "./engineUrl";

/**
 * "Can't reach the Tasks engine" notice with an inline Restart button. The
 * button only POSTs the app's own start route (a no-op if the engine is
 * already up) and, on success, points the app at the engine's address and
 * triggers an immediate poll.
 */
export function EngineDownNotice({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<{
    kind: "idle" | "starting" | "failed";
    message?: string;
  }>({ kind: "idle" });

  const restart = async () => {
    setState({ kind: "starting" });
    const outcome = await requestEngineStart(fetch);
    if (!outcome.ok) {
      setState({ kind: "failed", message: outcome.message });
      return;
    }
    if (outcome.url) setEngineUrl(outcome.url);
    setState({ kind: "idle" });
    window.dispatchEvent(new Event(ENGINE_RESTARTED_EVENT));
  };

  const starting = state.kind === "starting";
  const button = (
    <Button size="sm" variant="outline" disabled={starting} onClick={restart}>
      {starting ? "Restarting…" : "Restart Tasks engine"}
    </Button>
  );
  const failure = state.kind === "failed" && (
    <p role="alert" className="text-red text-xs">
      Couldn&apos;t restart: {state.message}
    </p>
  );

  if (compact) {
    return (
      <div
        role="status"
        className="rounded-card bg-amber-soft text-amber mx-6 mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-[13px]"
      >
        <span>
          Can&apos;t reach the Tasks engine right now — showing the last known state.
        </span>
        {button}
        {failure}
      </div>
    );
  }

  return (
    <div role="status" className="flex max-w-sm flex-col items-center gap-2 text-center">
      <p className="text-ink font-headline text-lg">Can&apos;t reach the Tasks engine</p>
      <p className="text-ink-muted text-[13.5px]">
        It starts with PMO Desk, so this is usually a moment&apos;s wait. This will
        connect automatically once it&apos;s available, or you can restart it now.
      </p>
      {button}
      {failure}
    </div>
  );
}
