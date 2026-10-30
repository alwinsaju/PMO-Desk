"use client";

import { useEffect } from "react";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToasts } from "@/lib/notifications/toastStore";
import type { Toast, ToastTone } from "@/lib/notifications/toasts";

const TONE_BAR: Record<ToastTone, string> = {
  info: "bg-accent",
  success: "bg-success-dot",
  warning: "bg-amber",
  danger: "bg-red",
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    if (toast.durationMs === 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      data-testid="toast"
      className={cn(
        "glass rounded-card pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 overflow-hidden py-3 pr-2 pl-4 shadow-lg",
        "relative",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", TONE_BAR[toast.tone])}
      />
      <p className="text-ink min-w-0 flex-1 text-[13px] leading-snug break-words">
        {toast.message}
      </p>
      {toast.action && (
        <button
          type="button"
          className="text-accent-ink hover:bg-chip rounded-control shrink-0 px-2 py-1 text-[12.5px] font-semibold"
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="text-ink-muted hover:text-ink hover:bg-chip rounded-control shrink-0 p-1"
        onClick={() => onDismiss(toast.id)}
      >
        <XIcon size={14} aria-hidden />
      </button>
    </div>
  );
}

/** Bottom-right stack of short messages (mounted once in layout.tsx). Sits above windows
 *  and the dock, below dialogs. Show one with `toast()` from lib/notifications/toastStore. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-24 z-[var(--z-chrome)] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
