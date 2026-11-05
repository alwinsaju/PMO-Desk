"use client";

import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { attentionMeaning } from "@/components/taskbar/dockBadge";
import { needsYouTotal, type NeedsYou } from "@/lib/dashboard/insights";
import { useNeedsYou } from "@/lib/dashboard/needsYouStore";
import { useStaffStore } from "@/lib/staff/staffStore";

/** What needs you, added up one way for the Dashboard dock badge and the Dashboard's Today card,
 *  so the two can never show different numbers. */
export function useNeedsYouTotal(): {
  parts: NeedsYou;
  total: number;
  meaning: string | null;
} {
  const pmo = useRemindersStore((s) => s.attention);
  const leave = useStaffStore(
    (s) => s.timeOff.filter((r) => r.status === "pending").length,
  );
  const tasks = useNeedsYou((s) => s.tasks);
  const registers = useNeedsYou((s) => s.registers);
  const parts = { pmo, leave, tasks, registers };
  return { parts, total: needsYouTotal(parts), meaning: attentionMeaning(parts) };
}
