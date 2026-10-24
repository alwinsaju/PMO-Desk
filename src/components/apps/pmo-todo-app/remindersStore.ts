"use client";

import { create } from "zustand";

export type NotificationPermissionState =
  NotificationPermission | "unsupported" | "unknown";

export interface InAppToast {
  id: number;
  title: string;
  body: string;
  todoId: string | null;
}

/** A request to open the PMO window (optionally on one to-do). PmoTodoApp
 *  consumes it, whether it was already open or has just been opened. */
export interface OpenRequest {
  id: number;
  todoId: string | null;
}

interface RemindersState {
  /** Running inside the Electron shell (window.aiOsDesktop exists). */
  desktop: boolean;
  /** Browser notification permission; "unknown" until the client has looked. */
  permission: NotificationPermissionState;
  /** Items needing attention right now (the badge number). */
  attention: number;
  toast: InAppToast | null;
  openRequest: OpenRequest | null;
  setEnvironment: (desktop: boolean, permission: NotificationPermissionState) => void;
  setPermission: (permission: NotificationPermissionState) => void;
  setAttention: (count: number) => void;
  showToast: (toast: Omit<InAppToast, "id">) => void;
  dismissToast: () => void;
  requestOpen: (todoId: string | null) => void;
  clearOpenRequest: (id: number) => void;
}

let counter = 0;

/** Shared by the Desktop-level poller (usePmoReminders), its toast, and the
 *  PMO window (permission button, deep link from a clicked notification). */
export const useRemindersStore = create<RemindersState>()((set) => ({
  desktop: false,
  permission: "unknown",
  attention: 0,
  toast: null,
  openRequest: null,
  setEnvironment: (desktop, permission) => set({ desktop, permission }),
  setPermission: (permission) => set({ permission }),
  setAttention: (attention) =>
    set((state) => (state.attention === attention ? state : { attention })),
  showToast: (toast) => set({ toast: { ...toast, id: ++counter } }),
  dismissToast: () => set({ toast: null }),
  requestOpen: (todoId) => set({ openRequest: { id: ++counter, todoId } }),
  clearOpenRequest: (id) =>
    set((state) => (state.openRequest?.id === id ? { openRequest: null } : state)),
}));

export function readNotificationPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Ask the browser for notification permission (it must come from a click). */
export async function enableReminders(): Promise<void> {
  const { setPermission } = useRemindersStore.getState();
  try {
    setPermission(await Notification.requestPermission());
  } catch {
    setPermission(readNotificationPermission());
  }
}

/** Show a sample reminder (an in-app toast, and a browser notification when
 *  allowed) so the user sees what one looks like. Fictional text only. */
export function sendTestReminder(): void {
  const toast = { title: "PMO To-Do: 1 item needs attention", body: "", todoId: null };
  useRemindersStore.getState().showToast(toast);
  try {
    new Notification(toast.title, { tag: "pmo-todo-test" });
  } catch {
    // The in-app toast above is still shown.
  }
}
