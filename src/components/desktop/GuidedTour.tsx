"use client";

import { useEffect } from "react";
import { openSettings } from "@/components/apps/settings-app/settingsNav";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { Button } from "@/components/ui";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { progressText, stepAt, tourLength } from "@/lib/platform/tour";
import { useTour } from "@/lib/platform/tourStore";

/** A short walk through the apps: a small card above the dock that opens each app as it goes. */
export function GuidedTour() {
  const open = useTour((s) => s.open);
  const index = useTour((s) => s.index);
  const go = useTour((s) => s.go);
  const close = useTour((s) => s.close);
  const step = stepAt(index);

  useEffect(() => {
    if (!open || !step?.appId) return;
    if (step.appId === "settings") openSettings("help");
    else openOrFocusBuiltInApp(step.appId);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function finish() {
    usePlatformPrefs.getState().update((p) => ({ ...p, tourDone: true }));
    close();
  }

  if (!open || !step) return null;
  const last = index === tourLength - 1;
  return (
    <div
      role="dialog"
      aria-label="Guided tour"
      data-testid="guided-tour"
      className="bg-card border-line rounded-card shadow-pop fixed bottom-24 left-1/2 z-[var(--z-overlay)] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 border p-5"
    >
      <p className="text-ink-muted text-[12px] font-semibold">{progressText(index)}</p>
      <h2 className="text-ink mt-1 text-[16px] font-bold">{step.title}</h2>
      <p className="text-ink-soft mt-1.5 text-[13.5px] leading-snug">{step.text}</p>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={finish}>
          Skip tour
        </Button>
        <span className="flex-1" />
        {index > 0 && (
          <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
            Back
          </Button>
        )}
        <Button size="sm" onClick={() => (last ? finish() : go(index + 1))}>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </div>
  );
}
