"use client";

import { useEffect } from "react";
import { fetchTasks } from "@/components/apps/tasks-app/api";
import { fetchState } from "@/components/apps/pmo-todo-app/api";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { useDashboardPrefs } from "@/lib/dashboard/dashboardPrefsStore";
import { briefingDue, briefingText, todaySummary } from "@/lib/dashboard/insights";
import { toast } from "@/lib/notifications/toastStore";
import { localParts } from "@/lib/pmo/due";
import { reviewCount } from "@/components/apps/pmo-todo-app/queueView";
import { todayIso } from "@/lib/staff/dates";
import { useRosterStore, useRosterSync } from "@/lib/staff/rosterStore";
import { useStaffStore, useStaffSync } from "@/lib/staff/staffStore";
import { peopleAway, whosOff } from "@/lib/staff/whosOff";

/**
 * Renders nothing. Once a day, after the chosen time and while PMO Desk is open, shows a short briefing:
 * what needs you today, who is out and which tasks are waiting. It reads and tells; it changes nothing.
 */
export function BriefingBackground() {
  useStaffSync();
  useRosterSync();

  useEffect(() => {
    let stopped = false;
    let busy = false;

    async function check() {
      if (stopped || busy || !useDashboardPrefs.persist.hasHydrated()) return;
      const prefs = useDashboardPrefs.getState();
      const now = new Date();
      const today = todayIso(now);
      if (
        !briefingDue(
          {
            enabled: prefs.briefingEnabled,
            time: prefs.briefingTime,
            lastDay: prefs.briefingDay,
          },
          now,
          today,
        )
      )
        return;
      const staff = useStaffStore.getState();
      if (staff.status !== "ready") return;
      busy = true;
      try {
        const [pmo, tasks] = await Promise.all([
          fetchState().catch(() => null),
          fetchTasks().catch(() => null),
        ]);
        const config = useRosterStore.getState().config;
        const away = whosOff({
          from: today,
          to: today,
          employees: staff.employees,
          timeOff: staff.timeOff,
          shifts: staff.shifts,
          members: config.members,
          events: config.events,
        });
        const summary = todaySummary({
          todos: pmo?.todos ?? [],
          today: pmo ? localParts(now, pmo.config.reminders.timeZone).day : today,
          now,
          prefs: pmo?.config.reminders ?? {
            timeZone: "Asia/Kolkata",
            workDays: [1, 2, 3, 4, 5],
            chaserDays: 2,
          },
          pendingLeave: staff.timeOff.filter((r) => r.status === "pending").length,
          reviewCount: pmo ? reviewCount(pmo.queue) : 0,
          tasksNeedingYou: (tasks ?? [])
            .filter((t) =>
              ["awaiting_review", "awaiting_send", "error"].includes(t.state),
            )
            .map((t) => t.displayName),
          awayToday: peopleAway(away),
        });
        const text = briefingText(summary.items, undefined, summary.total);
        useDashboardPrefs.getState().update((p) => ({ ...p, briefingDay: today }));
        toast({
          key: "briefing",
          message: text,
          durationMs: 20_000,
          action: {
            label: "Open Dashboard",
            run: () => openOrFocusBuiltInApp("dashboard"),
          },
        });
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          document.hidden
        ) {
          try {
            new Notification("Your day", { body: text });
          } catch {
            // The toast is enough.
          }
        }
      } finally {
        busy = false;
      }
    }

    const first = setTimeout(() => void check(), 6_000);
    const every = setInterval(() => void check(), 60_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  return null;
}
