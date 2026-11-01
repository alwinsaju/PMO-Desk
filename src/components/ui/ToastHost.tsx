"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
  type IconProps,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useToasts } from "@/lib/notifications/toastStore";
import { toastAnchorBox, type Box } from "@/lib/notifications/toastAnchor";
import type { Toast, ToastTone } from "@/lib/notifications/toasts";

/** Icon + colour per tone; `danger` is the error tone. */
const TONE_ICON: Record<ToastTone, { Icon: ComponentType<IconProps>; color: string }> = {
  success: { Icon: CheckCircleIcon, color: "text-success" },
  info: { Icon: InfoIcon, color: "text-info" },
  warning: { Icon: WarningIcon, color: "text-amber" },
  danger: { Icon: XCircleIcon, color: "text-red" },
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  // Hovering or focusing a toast pauses its timer, so it can be read and its action used.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.durationMs === 0 || paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, paused, onDismiss]);

  const { Icon, color } = TONE_ICON[toast.tone];

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      data-testid="toast"
      data-tone={toast.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="bg-surface-elevated border-line-strong rounded-card shadow-float pointer-events-auto flex w-[min(22rem,100%)] items-start gap-3 border py-3 pr-2 pl-3.5"
    >
      <Icon aria-hidden size={20} weight="fill" className={cn("mt-px shrink-0", color)} />
      <div className="min-w-0 flex-1">
        {toast.title && (
          <p className="text-ink text-[13.5px] leading-snug font-semibold break-words">
            {toast.title}
          </p>
        )}
        <p
          className={cn(
            "text-[13px] leading-snug break-words",
            toast.title ? "text-ink-muted mt-0.5" : "text-ink",
          )}
        >
          {toast.message}
        </p>
      </div>
      {toast.action && (
        <button
          type="button"
          className="text-accent-ink hover:bg-chip rounded-control focus-ring h-8 shrink-0 px-2.5 text-[12.5px] font-semibold"
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
        className="text-ink-muted hover:text-ink hover:bg-chip rounded-control focus-ring flex h-8 w-8 shrink-0 items-center justify-center"
        onClick={() => onDismiss(toast.id)}
      >
        <XIcon size={14} aria-hidden />
      </button>
    </div>
  );
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);

/** The box of the focused window, tracked every frame while toasts are showing (a window
 *  can be dragged, resized or maximised under them). Null when there is none. */
function useActiveWindowBox(active: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(
        '[data-window-chrome][data-focused="true"]',
      );
      const r = el?.getBoundingClientRect();
      const next = toastAnchorBox(
        r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
        { width: window.innerWidth, height: window.innerHeight },
      );
      setBox((prev) => (sameBox(prev, next) ? prev : next));
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active ? box : null;
}

/** The stack of short messages (mounted once in layout.tsx), always in the bottom-right
 *  corner of the active window so it never hangs half outside it; with no usable window it
 *  uses the bottom-right of the screen, above the command bar. Sits above windows and the
 *  dock, below dialogs. Show one with `toast()` from lib/notifications/toastStore. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const box = useActiveWindowBox(toasts.length > 0);
  return (
    <div
      aria-label="Notifications"
      style={box ?? undefined}
      className={cn(
        "pointer-events-none fixed z-[var(--z-chrome)] flex flex-col items-end justify-end gap-2",
        box ? "p-4" : "right-4 bottom-24",
      )}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
