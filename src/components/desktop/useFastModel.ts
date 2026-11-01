"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSetupStatus, postSetupAction } from "@/components/setup/setupApi";
import {
  fastSwitchView,
  type SwitchOption,
  type SwitchView,
} from "@/lib/ai-runtime/modelSwitchView";

interface ModelState {
  active: string;
  preferred: string;
  options: SwitchOption[];
}

type ModelReply = { ok: true } & ModelState;

const PULL_POLL_MS = 2_000;

async function readModel(): Promise<ModelState | null> {
  try {
    const response = await fetch("/api/ai/model", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as ModelReply | { ok: false };
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

async function chooseModel(
  model: string,
): Promise<{ ok: boolean; reason?: string; needsDownload?: boolean }> {
  try {
    const response = await fetch("/api/ai/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10_000),
    });
    return (await response.json()) as {
      ok: boolean;
      reason?: string;
      needsDownload?: boolean;
    };
  } catch {
    return { ok: false, reason: "Could not reach PMO Desk. Try again in a moment." };
  }
}

/** The "Fast AI model" switch: reads which model is in use, switches it, and when the fast
 *  model is not on this computer yet starts its download and follows the progress. */
export function useFastModel(): {
  view: SwitchView | null;
  busy: boolean;
  toggle: (fast: boolean) => void;
} {
  const [model, setModel] = useState<ModelState | null>(null);
  const [pull, setPull] = useState<{ model: string; percent: number | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const next = await readModel();
    if (alive.current && next) setModel(next);
    return next;
  }, []);

  // Follows a running download (also one started earlier and still going).
  const follow = useCallback(async () => {
    for (;;) {
      const status = await fetchSetupStatus();
      if (!alive.current) return;
      const job = status?.jobs.pull;
      if (!job?.running) {
        setPull(null);
        await refresh();
        return;
      }
      setPull({
        model: job.progress?.model ?? "",
        percent: job.progress?.percent ?? null,
      });
      await new Promise((resolve) => setTimeout(resolve, PULL_POLL_MS));
    }
  }, [refresh]);

  useEffect(() => {
    alive.current = true;
    void refresh().then((next) => {
      const fast = next?.options.find((o) => o.kind === "fast");
      if (next && fast && fast.installed === false && next.preferred === fast.id)
        void follow();
    });
    return () => {
      alive.current = false;
    };
  }, [refresh, follow]);

  const toggle = useCallback(
    (fast: boolean) => {
      if (!model) return;
      const target = model.options.find((o) => o.kind === (fast ? "fast" : "accurate"));
      if (!target) return;
      setBusy(true);
      setError(null);
      void (async () => {
        let reply = await chooseModel(target.id);
        if (!reply.ok && reply.needsDownload) {
          reply = await postSetupAction({ action: "pull-model", model: target.id });
          if (reply.ok) void follow();
        }
        if (alive.current) {
          if (!reply.ok) setError(reply.reason ?? "That did not work.");
          setBusy(false);
        }
        await refresh();
      })();
    },
    [model, follow, refresh],
  );

  return {
    view: model ? fastSwitchView({ ...model, pull, error }) : null,
    busy,
    toggle,
  };
}
