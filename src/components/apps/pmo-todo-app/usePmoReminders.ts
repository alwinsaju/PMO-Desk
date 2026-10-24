"use client";

import { useEffect, useRef } from "react";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import type { Toast } from "@/lib/pmo/due";
import { acknowledgeReminders, claimReminders, fetchDue } from "./api";
import { readNotificationPermission, useRemindersStore } from "./remindersStore";

export const REMINDER_POLL_MS = 60_000;
const FIRST_POLL_MS = 4_000;
const PMO_APP_ID = "pmo-todo";

/**
 * Keeps the reminder machinery alive for the whole desktop (it is mounted from
 * a Desktop-level component, so it runs with the PMO window closed):
 *
 *  - every 60 s it refreshes the number of items needing attention and pushes
 *    it to the dock badge (and, in the Electron shell, to the taskbar overlay);
 *  - in a plain browser tab it also CLAIMS due reminders from the server
 *    (POST /api/pmo/due/claim), shows them as a web Notification (when the
 *    user granted permission) and an in-app toast, then acknowledges the claim;
 *  - inside the Electron shell (window.aiOsDesktop) it never claims: the shell's
 *    main process does, so the same reminder is not shown twice;
 *  - without notification permission, the dock badge and a "(N)" title prefix
 *    (see TitlePrefix in PmoReminders.tsx) are the fallback.
 *
 * Web reminders only fire while this tab is open and the app server is
 * reachable; the desktop app is the reliable path.
 */
export function usePmoReminders(onOpen: (todoId: string | null) => void) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const bridge = getDesktopBridge();
    const store = useRemindersStore.getState();
    store.setEnvironment(Boolean(bridge), readNotificationPermission());

    // Permission can also be changed from the browser's site settings.
    let permissionStatus: PermissionStatus | null = null;
    const syncPermission = () =>
      useRemindersStore.getState().setPermission(readNotificationPermission());
    if (!bridge && typeof navigator !== "undefined" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          permissionStatus = status;
          status.addEventListener("change", syncPermission);
        })
        .catch(() => undefined);
    }

    // Coming back to the tab (e.g. after changing the site's notification
    // setting) re-reads the permission.
    if (!bridge) window.addEventListener("focus", syncPermission);

    const unsubscribeOpen = bridge?.onOpenTodo((todoId) => openRef.current(todoId));

    const clientId = `web:${Math.random().toString(36).slice(2, 10)}`;
    let cancelled = false;
    let inFlight = false;

    function deliver(toast: Toast) {
      useRemindersStore.getState().showToast(toast);
      if (readNotificationPermission() !== "granted") return;
      try {
        // `tag` makes a newer reminder replace the previous one instead of stacking.
        const notification = new Notification(toast.title, {
          body: toast.body || undefined,
          tag: "pmo-todo-reminder",
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
          openRef.current(toast.todoId);
        };
      } catch {
        // Some browsers refuse `new Notification` outside a service worker;
        // the in-app toast above still showed.
      }
    }

    async function tick() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        let attention: number | null = null;
        if (!bridge) {
          const reply = await claimReminders(clientId);
          if (cancelled) return;
          if (reply.ok) {
            attention = reply.attention.count;
            if (reply.claimId && reply.toast) {
              deliver(reply.toast);
              await acknowledgeReminders(reply.claimId);
            }
          }
        }
        if (attention === null) {
          // The shell owns this server (or the claim was refused): read-only.
          const due = await fetchDue();
          if (due.ok) attention = due.attention.count;
        }
        if (attention !== null && !cancelled) {
          useRemindersStore.getState().setAttention(attention);
          useDockBadgeStore.getState().setBadge(PMO_APP_ID, attention);
          bridge?.setBadge(attention);
        }
      } catch {
        // Server not reachable right now: keep the last badge, try next minute.
      } finally {
        inFlight = false;
      }
    }

    const first = setTimeout(() => void tick(), FIRST_POLL_MS);
    const timer = setInterval(() => void tick(), REMINDER_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      unsubscribeOpen?.();
      permissionStatus?.removeEventListener("change", syncPermission);
      window.removeEventListener("focus", syncPermission);
    };
  }, []);
}
