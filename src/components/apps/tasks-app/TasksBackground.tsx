"use client";

import { useEffect } from "react";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { toast } from "@/lib/notifications/toastStore";
import { dueSchedules, snapshotStates, stateNotices } from "@/lib/tasks/automation";
import { useNeedsYou } from "@/lib/dashboard/needsYouStore";
import { markTemplateUsed } from "@/lib/templates/usageStore";
import { fetchAssignedTemplate } from "../templates-app/api";
import { explainFailure } from "@/lib/tasks/failureExplainer";
import { dequeue, canDispatch, decide } from "@/lib/tasks/sendQueue";
import { scheduleMessage, staleUploads } from "@/lib/tasks/taskSchedule";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { fetchTasks, getDraftSummary, getInputs, sendTask, startTask } from "./api";
import { parseDraftSummary } from "./draftSummary";
import { useTasksNav } from "./tasksNavStore";
import type { Task } from "./types";

const POLL_MS = 20_000;

/** A system notice when the window is hidden (Electron and browsers both support it). */
function systemNotice(title: string, body: string) {
  if (typeof Notification === "undefined" || !document.hidden) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Some environments refuse a page notification; the toast still shows.
  }
}

const openTasks = (taskId?: string) => {
  if (taskId) useTasksNav.getState().requestDetail(taskId);
  openOrFocusBuiltInApp("tasks");
};

/**
 * Runs while PMO Desk is open, with or without the Tasks window: tells you when a task needs you, fails or
 * finishes, handles the schedules (reminders, and preparing a task that is allowed to prepare itself), and
 * sends the mails you queued, but only if the task is still waiting and the recipients are unchanged.
 * Nothing here approves or sends anything you did not approve yourself.
 */
export function TasksBackground() {
  useEffect(() => {
    let stopped = false;
    let prev: Map<string, string> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;

    const prefs = () => useTasksPrefs.getState();

    async function schedulePass(tasks: Task[]) {
      const now = new Date();
      const ids = new Set(tasks.map((t) => t.id));
      for (const { schedule, due } of dueSchedules(
        prefs().schedules,
        prefs().handled,
        ids,
        now,
      )) {
        const task = tasks.find((t) => t.id === schedule.taskId)!;
        const inputs = await getInputs(task.id).catch(() => null);
        const ready = Boolean(
          inputs?.ok && inputs.inputs?.every((i) => !i.required || i.present),
        );
        const stale = ready ? staleUploads(inputs?.inputs ?? [], due.day) : [];
        let prepared = false;
        if (
          schedule.autoPrepare &&
          ready &&
          stale.length === 0 &&
          task.state === "resting"
        ) {
          const started = await startTask(task.id).catch(() => null);
          prepared = started?.ok === true;
        }
        prefs().update((t) => ({ ...t, handled: { ...t.handled, [task.id]: due.day } }));
        const message = scheduleMessage(task.displayName, due, ready, prepared, stale);
        toast({
          key: `sched-${task.id}`,
          tone: due.kind === "missed" || stale.length > 0 ? "warning" : "info",
          durationMs: 12_000,
          message,
          action: { label: "Open Tasks", run: () => openTasks(task.id) },
        });
        systemNotice(task.displayName, message);
      }
    }

    async function sendPass(tasks: Task[]) {
      const now = new Date();
      for (const item of prefs().queue) {
        const verdict = decide(item, now);
        if (verdict === "wait") continue;
        const remove = () =>
          prefs().update((t) => ({ ...t, queue: dequeue(t.queue, item.id) }));
        const task = tasks.find((t) => t.id === item.taskId);
        if (verdict === "overdue") {
          remove();
          toast({
            tone: "warning",
            durationMs: 15_000,
            message: `The queued send of ${item.taskName} was due while PMO Desk was closed. It was not sent; it is still waiting for you.`,
            action: { label: "Open Tasks", run: () => openTasks(item.taskId) },
          });
          continue;
        }
        const summary = parseDraftSummary(
          await getDraftSummary(item.taskId).catch(() => null),
        );
        const gate = canDispatch(
          item,
          task?.state,
          summary ? { to: summary.to, cc: summary.cc } : null,
        );
        if (!gate.ok) {
          remove();
          toast({
            tone: "warning",
            durationMs: 15_000,
            message: `${item.taskName} was not sent: ${gate.reason} Open Tasks to review it.`,
            action: { label: "Open Tasks", run: () => openTasks(item.taskId) },
          });
          continue;
        }
        const reply = await sendTask(item.taskId).catch(() => null);
        remove();
        toast(
          reply?.ok
            ? { tone: "success", message: `Sent ${item.taskName} as you queued it.` }
            : {
                tone: "danger",
                message: `${item.taskName} could not be sent: ${reply?.reason ?? "the engine did not answer"}.`,
              },
        );
      }
    }

    async function tick() {
      if (stopped || busy) return;
      if (!useTasksPrefs.persist.hasHydrated()) {
        timer = setTimeout(tick, 1_000);
        return;
      }
      busy = true;
      try {
        const tasks = await fetchTasks();
        if (stopped) return;
        if (prefs().notifyOnFinish) {
          for (const n of stateNotices(prev, tasks)) {
            const task = tasks.find((t) => t.id === n.taskId);
            // A task that reaches its review step has made its draft: note it for the template's "last used".
            if (n.kind === "review")
              void fetchAssignedTemplate(`task:${n.taskId}`).then((tpl) =>
                markTemplateUsed(tpl?.id),
              );
            const text =
              n.kind === "failed" && task?.error
                ? `${n.text} ${explainFailure(task.error).title}.`
                : n.text;
            toast({
              key: `task-${n.taskId}`,
              tone:
                n.kind === "failed" ? "danger" : n.kind === "done" ? "success" : "info",
              durationMs: 10_000,
              message: text,
              action: { label: "Open Tasks", run: () => openTasks(n.taskId) },
            });
            systemNotice("PMO Desk", text);
          }
        }
        prev = snapshotStates(tasks);
        useNeedsYou
          .getState()
          .setTasks(
            tasks.filter((t) =>
              ["awaiting_review", "awaiting_send", "error"].includes(t.state),
            ).length,
          );
        await schedulePass(tasks);
        await sendPass(tasks);
        prefs().update((t) => ({ ...t, checkedAt: new Date().toISOString() }));
      } catch {
        // The engine is not running (or not reachable yet): try again next time.
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      }
    }

    // The saved preferences load from the server a moment after start; wait for them so a schedule
    // that was already handled is not reported a second time.
    const start = setTimeout(tick, 4_000);
    return () => {
      stopped = true;
      clearTimeout(start);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
