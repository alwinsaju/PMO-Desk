"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { useBarAction } from "./barActionStore";

/** "Are you sure?" card above the command bar. Focus starts on Cancel, so Enter or
 *  Space can never confirm by accident; Esc cancels. */
export function BarActionCard() {
  const pending = useBarAction((s) => s.pending);
  const answer = useBarAction((s) => s.answer);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = pending?.id;

  useEffect(() => {
    if (id === undefined) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useBarAction.getState().answer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id]);

  if (!pending) return null;
  return (
    <div
      role="alertdialog"
      aria-label={pending.title}
      aria-describedby="bar-action-detail"
      className="glass-pop rounded-card pointer-events-auto w-[min(26rem,92vw)] px-4 py-3.5"
    >
      <b className="text-ink block text-[14px] font-bold">{pending.title}</b>
      <p
        id="bar-action-detail"
        className="text-ink-soft mt-1.5 text-[13px] leading-snug break-words whitespace-pre-line"
      >
        {pending.detail}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button ref={cancelRef} variant="outline" size="sm" onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => answer(true)}>
          {pending.confirmLabel}
        </Button>
      </div>
    </div>
  );
}
