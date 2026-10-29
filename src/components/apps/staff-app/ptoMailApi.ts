"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PtoMailState } from "@/lib/staff/ptoMailServer";

const POLL_MS = 15_000;

export type { PtoMailState };

/** The PTO email log and folder state, or null when the server cannot say. */
export async function fetchPtoMail(): Promise<PtoMailState | null> {
  try {
    const response = await fetch("/api/staff/pto-mail", { cache: "no-store" });
    const body = (await response.json()) as { ok?: boolean } & Partial<PtoMailState>;
    return response.ok && body.ok ? (body as PtoMailState) : null;
  } catch {
    return null;
  }
}

export async function postPtoMail(
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetch("/api/staff/pto-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { ok?: boolean; reason?: string };
    return json.ok
      ? { ok: true }
      : { ok: false, reason: json.reason ?? "That did not work." };
  } catch {
    return { ok: false, reason: "Can't reach the AI OS server. Try again in a moment." };
  }
}

/** The PTO email state, refreshed while the component is mounted (faster while a scan runs). */
export function usePtoMail(): {
  state: PtoMailState | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<PtoMailState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await fetchPtoMail();
    if (next) setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const next = await fetchPtoMail();
      if (cancelled) return;
      if (next) setState(next);
      timer.current = setTimeout(() => void tick(), next?.running ? 3_000 : POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, []);

  return { state, refresh };
}
