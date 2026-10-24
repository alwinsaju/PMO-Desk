"use client";

import { useEffect } from "react";
import { BellRingingIcon, ClipboardTextIcon, XIcon } from "@phosphor-icons/react";
import { useWindowStore } from "@/components/window-manager";
import { IconButton } from "@/components/ui";
import { usePmoReminders } from "@/components/apps/pmo-todo-app/usePmoReminders";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";

const PMO_APP_ID = "pmo-todo";
const TOAST_MS = 12_000;

/** Show the PMO To-Do window (restoring or opening it) and, when given, ask it
 *  to open one to-do. Used by clicked notifications and the in-app toast. */
function openPmoTodo(todoId: string | null) {
  const { windows, restoreWindow, openWindow } = useWindowStore.getState();
  const existing = Object.values(windows)
    .filter((w) => w.appId === PMO_APP_ID)
    .sort((a, b) => a.zIndex - b.zIndex)
    .at(-1);
  if (existing) restoreWindow(existing.id);
  else openWindow(PMO_APP_ID, { title: "PMO To-Do", icon: <ClipboardTextIcon /> });
  useRemindersStore.getState().requestOpen(todoId);
}

/**
 * Mounted once from Desktop.tsx, so reminders keep working with the PMO window
 * closed. Renders nothing except the in-app toast and keeps the browser tab
 * title in step with the badge when notifications are not available.
 */
export function PmoReminders() {
  usePmoReminders(openPmoTodo);
  return (
    <>
      <TitlePrefix />
      <ReminderToast />
    </>
  );
}

const stripPrefix = (title: string) => title.replace(/^\(\d+\)\s/, "");

/** "(N) AI OS" in the tab title when this is a plain browser tab without
 *  notification permission: the title is then the only thing a background tab
 *  can show. The Electron shell pins its own window title, so it is skipped. */
function TitlePrefix() {
  const attention = useRemindersStore((s) => s.attention);
  const desktop = useRemindersStore((s) => s.desktop);
  const permission = useRemindersStore((s) => s.permission);
  useEffect(() => {
    const wanted =
      !desktop && permission !== "granted" && permission !== "unknown" && attention > 0;
    const apply = () => {
      const base = stripPrefix(document.title);
      const next = wanted ? `(${attention}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Next/React may rewrite or move the <title> element (it is not always
    // inside <head>), so instead of watching the DOM, re-check once a second.
    const timer = setInterval(apply, 1000);
    return () => {
      clearInterval(timer);
      document.title = stripPrefix(document.title);
    };
  }, [attention, desktop, permission]);
  return null;
}

function ReminderToast() {
  const toast = useRemindersStore((s) => s.toast);
  const dismiss = useRemindersStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-surface-elevated shadow-float fixed right-4 bottom-4 z-[var(--z-overlay)] flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border p-3.5"
    >
      <BellRingingIcon size={20} weight="fill" className="text-accent mt-0.5 shrink-0" />
      <button
        type="button"
        onClick={() => {
          openPmoTodo(toast.todoId);
          dismiss();
        }}
        className="focus-visible:ring-accent min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2"
      >
        <span className="text-ink block text-[13px] leading-snug font-semibold">
          {toast.title}
        </span>
        {toast.body && (
          <span className="text-ink-muted mt-0.5 block text-[12px] leading-snug whitespace-pre-line">
            {toast.body}
          </span>
        )}
        <span className="text-ink-faint mt-1 block text-[11px]">
          Click to open PMO To-Do
        </span>
      </button>
      <IconButton aria-label="Dismiss reminder" size="sm" onClick={dismiss}>
        <XIcon size={14} />
      </IconButton>
    </div>
  );
}
