"use client";

import { Button } from "@/components/ui";
import { enableReminders, sendTestReminder, useRemindersStore } from "./remindersStore";
import { reminderStatus } from "./toolbarView";

/** Where the reminder situation is explained in plain words: the Reminders
 *  section of Settings. Inside the desktop app there is nothing to do (it
 *  delivers reminders itself); in a browser tab it offers the permission
 *  request, which must come from a click, and a sample reminder. The toolbar
 *  only carries a small bell while the question is still open. */
export function NotificationStatus({ attention }: { attention: number }) {
  const desktop = useRemindersStore((s) => s.desktop);
  const permission = useRemindersStore((s) => s.permission);
  const status = reminderStatus(permission, desktop, attention);
  if (!status) return null;

  return (
    <div
      data-reminders-notice={desktop ? "desktop" : permission}
      className="border-line bg-card text-ink-soft rounded-card flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3 text-[13px] leading-relaxed"
    >
      <span className="min-w-0 flex-1 basis-60">
        <strong className="text-ink font-semibold">{status.title}</strong> {status.text}
      </span>
      {!desktop && permission === "default" && (
        <Button variant="secondary" onClick={() => void enableReminders()}>
          Enable reminders
        </Button>
      )}
      {!desktop && permission === "granted" && (
        <Button variant="secondary" onClick={sendTestReminder}>
          Send a test
        </Button>
      )}
    </div>
  );
}
