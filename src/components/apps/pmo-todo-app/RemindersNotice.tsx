"use client";

import { Button } from "@/components/ui";
import { readNotificationPermission, useRemindersStore } from "./remindersStore";

/** The one place the reminder situation is explained in plain words. Inside the
 *  desktop app there is nothing to do (the app delivers reminders itself), so
 *  this renders nothing there. In a browser tab it offers the permission
 *  request, which must come from a click, and says what to expect. */
export function RemindersNotice({ attention }: { attention: number }) {
  const desktop = useRemindersStore((s) => s.desktop);
  const permission = useRemindersStore((s) => s.permission);
  const setPermission = useRemindersStore((s) => s.setPermission);
  const showToast = useRemindersStore((s) => s.showToast);

  if (desktop || permission === "unknown") return null;

  const enable = async () => {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(readNotificationPermission());
    }
  };
  const test = () => {
    // A fictional message, so the user sees what a reminder looks like.
    const toast = {
      title: "PMO To-Do: 1 item needs attention",
      body: "",
      todoId: null,
    };
    showToast(toast);
    try {
      new Notification(toast.title, { tag: "pmo-todo-test" });
    } catch {
      // The in-app toast above is still shown.
    }
  };

  const caveat =
    "Browser reminders only fire while this tab is open; the AI OS desktop app is the reliable way to get them.";

  return (
    <div
      data-reminders-notice={permission}
      className="border-border/60 text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-neutral-50 px-4 py-2 text-[12px]"
    >
      {permission === "granted" && (
        <>
          <span>
            <strong className="text-ink font-medium">Reminders are on.</strong> {caveat}
          </span>
          <Button variant="ghost" size="sm" onClick={test}>
            Send a test
          </Button>
        </>
      )}
      {permission === "default" && (
        <>
          <span>
            <strong className="text-ink font-medium">Reminders are off.</strong> {caveat}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void enable()}>
            Enable reminders
          </Button>
        </>
      )}
      {permission === "denied" && (
        <span>
          <strong className="text-ink font-medium">Notifications are blocked</strong> for
          this site, so reminders show as the badge on the dock icon
          {attention > 0 ? ` (${attention})` : ""} and a count in the tab title. To get
          pop-ups, allow notifications in the browser&apos;s site settings. {caveat}
        </span>
      )}
      {permission === "unsupported" && (
        <span>
          <strong className="text-ink font-medium">
            This browser cannot show notifications,
          </strong>{" "}
          so reminders show as the badge on the dock icon and a count in the tab title.{" "}
          {caveat}
        </span>
      )}
    </div>
  );
}
