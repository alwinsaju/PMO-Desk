"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleNotchIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { useStaffNav } from "@/components/apps/staff-app/staffNavStore";
import { easeEntrance, easeExit } from "@/lib/motion";
import { formatRange } from "@/lib/staff/dates";
import { describePtoAlert, unseenIds, type PtoAlertView } from "@/lib/staff/ptoNudge";

const POLL_MS = 20_000;
const SEEN_KEY = "ai-os:pto-seen";
const MAX_SEEN = 200;

function readSeen(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-MAX_SEEN)));
  } catch {
    // Storage unavailable: the note simply shows again next time.
  }
}

/** The AI's own heads-up, above the orb: it read the PTO emails in the background and
 *  tells the person which leave requests wait for them. Polls a tiny read-only route
 *  (nothing is loaded into the Staff store), only while the window is visible. */
export function usePtoNudge() {
  const [alert, setAlert] = useState<PtoAlertView | null>(null);
  const [seen, setSeen] = useState<string[]>([]);

  useEffect(() => {
    setSeen(readSeen());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          const response = await fetch("/api/staff/pto-alert", { cache: "no-store" });
          const body = (await response.json()) as PtoAlertView & { ok?: boolean };
          if (!stopped && body.ok) setAlert(body);
        } catch {
          // The server is restarting or offline: keep what is shown.
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void poll();
      }
    };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const unseen = alert ? unseenIds(alert, seen) : [];
  const acknowledge = useCallback(() => {
    if (!alert) return;
    const next = [...new Set([...seen, ...alert.pending.map((p) => p.id)])];
    setSeen(next);
    writeSeen(next);
  }, [alert, seen]);

  return { alert, unseen, acknowledge };
}

export function AiNudge({ alert, unseen, acknowledge }: ReturnType<typeof usePtoNudge>) {
  const copy = alert ? describePtoAlert(alert, unseen, formatRange) : null;

  const review = () => {
    openOrFocusBuiltInApp("staff");
    useStaffNav.getState().requestOpen({ tab: "timeoff", timeOffStatus: "pending" });
    acknowledge();
  };

  return (
    <AnimatePresence initial={false}>
      {copy && (
        <motion.div
          key={copy.kind}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{
            opacity: 0,
            y: 6,
            scale: 0.98,
            transition: { duration: 0.18, ease: easeExit },
          }}
          transition={{ duration: 0.28, ease: easeEntrance }}
          className="glass rounded-surface pointer-events-auto flex w-[min(22rem,calc(100vw-3rem))] items-start gap-3 p-3.5"
        >
          <span className="bg-accent-soft text-accent-ink mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full">
            {copy.kind === "reading" ? (
              <CircleNotchIcon size={17} aria-hidden className="animate-spin" />
            ) : (
              <SparkleIcon size={17} weight="duotone" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-ink text-[13px] leading-snug font-semibold">
              {copy.title}
            </p>
            {copy.lines.map((line) => (
              <p key={line} className="text-ink-muted mt-0.5 text-[12.5px] leading-snug">
                {line}
              </p>
            ))}
            {copy.kind === "approve" && (
              <div className="mt-2.5 flex items-center gap-2">
                <Button size="sm" onClick={review}>
                  Review
                </Button>
                <Button size="sm" variant="ghost" onClick={acknowledge}>
                  Later
                </Button>
              </div>
            )}
          </div>
          {copy.kind === "approve" && (
            <IconButton aria-label="Dismiss" size="sm" onClick={acknowledge}>
              <XIcon size={14} />
            </IconButton>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
