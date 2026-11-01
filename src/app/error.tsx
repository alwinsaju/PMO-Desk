"use client";

import { useEffect } from "react";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { Button } from "@/components/ui";

/** Route-level safety net: a render error outside any app window (the desktop
 *  shell itself) shows this instead of Next's blank error screen. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[desktop] render failed:", error);
  }, [error]);

  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <Wallpaper />
      <section
        role="alert"
        className="glass-pop rounded-surface animate-rise relative w-full max-w-md px-8 py-10 text-center"
      >
        <h1 className="font-headline text-ink text-3xl leading-tight tracking-[-0.03em]">
          Something went wrong
        </h1>
        <p className="text-ink-soft mx-auto mt-3 max-w-sm text-sm leading-6">
          PMO Desk hit an unexpected problem. Your data is safe. Try again, and restart
          the app if it keeps happening.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}
