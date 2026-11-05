import { useToasts } from "@/lib/notifications/toastStore";

/** The "N checklists started" toast. It has a key so it can be taken away when its checklists are. */
export const CHECKLIST_TOAST_KEY = "staff-checklists-started";

export function dismissToastByKey(key: string): void {
  const { toasts, dismiss } = useToasts.getState();
  for (const t of toasts) if (t.key === key) dismiss(t.id);
}
