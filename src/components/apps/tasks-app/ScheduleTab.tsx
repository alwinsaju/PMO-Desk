"use client";

import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { dequeue, type QueuedSend } from "@/lib/tasks/sendQueue";
import {
  WEEKDAYS,
  defaultSchedule,
  describeSchedule,
  pendingOccurrence,
  type TaskSchedule,
} from "@/lib/tasks/taskSchedule";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { sendTask } from "./api";
import type { Task } from "./types";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** When each task should be prepared (while AI OS is open) and the sends queued for later. */
export function ScheduleTab({
  tasks,
  onSettled,
}: {
  tasks: Task[];
  onSettled: () => void;
}) {
  const prefs = useTasksPrefs();
  const update = prefs.update;

  const setSchedule = (taskId: string, next: TaskSchedule | null) =>
    update((t) => ({
      ...t,
      schedules: next
        ? [...t.schedules.filter((s) => s.taskId !== taskId), next]
        : t.schedules.filter((s) => s.taskId !== taskId),
    }));

  const sendNow = async (item: QueuedSend) => {
    const reply = await sendTask(item.taskId);
    if (reply.ok) {
      update((t) => ({ ...t, queue: dequeue(t.queue, item.id) }));
      toast({ tone: "success", message: `Sent ${item.taskName}.` });
    } else {
      toast({ tone: "danger", message: reply.reason ?? "It could not be sent." });
    }
    onSettled();
  };

  return (
    <div className="flex flex-col gap-6 px-6 pt-2 pb-6" data-testid="schedule-tab">
      <section aria-label="Schedules" className="flex flex-col gap-2.5">
        <h3 className="text-ink text-[14px] font-bold">Schedules</h3>
        <p className="text-ink-muted text-[12.5px]">
          AI OS works out what is due only while it is open. Anything that came due while
          it was closed is reported the next time it starts. A scheduled task can be
          prepared for you, but it always stops at the first review step; nothing is sent
          without your approval.
        </p>
        {tasks.map((task) => {
          const schedule = prefs.schedules.find((s) => s.taskId === task.id) ?? null;
          const due = schedule
            ? pendingOccurrence(schedule, prefs.handled[task.id], new Date())
            : null;
          return (
            <div
              key={task.id}
              data-testid="schedule-row"
              className="border-line bg-card rounded-card flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3"
            >
              <span className="text-ink min-w-40 flex-1 text-[13.5px] font-semibold">
                {task.displayName}
              </span>
              <select
                aria-label={`How often: ${task.displayName}`}
                className={SELECT}
                value={schedule?.cadence ?? "off"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "off") setSchedule(task.id, null);
                  else
                    setSchedule(task.id, {
                      ...(schedule ?? defaultSchedule(task.id)),
                      cadence: v as TaskSchedule["cadence"],
                    });
                }}
              >
                <option value="off">Not scheduled</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {schedule?.cadence === "weekly" && (
                <select
                  aria-label={`Day of the week: ${task.displayName}`}
                  className={SELECT}
                  value={schedule.weekday}
                  onChange={(e) =>
                    setSchedule(task.id, { ...schedule, weekday: Number(e.target.value) })
                  }
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {schedule?.cadence === "monthly" && (
                <select
                  aria-label={`Day of the month: ${task.displayName}`}
                  className={SELECT}
                  value={schedule.dayOfMonth}
                  onChange={(e) =>
                    setSchedule(task.id, {
                      ...schedule,
                      dayOfMonth: Number(e.target.value),
                    })
                  }
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </select>
              )}
              {schedule && (
                <>
                  <input
                    type="time"
                    aria-label={`Time: ${task.displayName}`}
                    className={SELECT}
                    value={schedule.time}
                    onChange={(e) =>
                      e.target.value &&
                      setSchedule(task.id, { ...schedule, time: e.target.value })
                    }
                  />
                  <label className="text-ink-soft flex items-center gap-2 text-[12.5px]">
                    <input
                      type="checkbox"
                      checked={schedule.autoPrepare}
                      onChange={(e) =>
                        setSchedule(task.id, {
                          ...schedule,
                          autoPrepare: e.target.checked,
                        })
                      }
                      className="accent-accent h-4 w-4"
                    />
                    Prepare it for me
                  </label>
                  <p className="text-ink-muted w-full text-[12px]">
                    Runs {describeSchedule(schedule)}.
                    {due && due.kind !== "none" ? ` Not yet handled for ${due.day}.` : ""}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </section>

      <section aria-label="Send later" className="flex flex-col gap-2.5">
        <h3 className="text-ink text-[14px] font-bold">Send later</h3>
        {prefs.queue.length === 0 ? (
          <p className="text-ink-muted text-[12.5px]" data-testid="queue-empty">
            Nothing is queued. Choose “Or send later” when you confirm a mail.
          </p>
        ) : (
          prefs.queue.map((item) => (
            <div
              key={item.id}
              data-testid="queue-row"
              className="border-line bg-card rounded-card flex flex-wrap items-center gap-3 border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-ink text-[13.5px] font-semibold">{item.taskName}</p>
                <p className="text-ink-muted text-[12px]">
                  Goes out {stamp(item.at)} · To{" "}
                  {item.recipients.to.join("; ") || "(none)"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void sendNow(item)}>
                Send now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update((t) => ({ ...t, queue: dequeue(t.queue, item.id) }))
                }
              >
                Cancel
              </Button>
            </div>
          ))
        )}
      </section>

      <section aria-label="Notifications" className="flex flex-col gap-2">
        <label className="text-ink-soft flex items-center gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={prefs.notifyOnFinish}
            onChange={(e) => update((t) => ({ ...t, notifyOnFinish: e.target.checked }))}
            className="accent-accent h-4 w-4"
          />
          Tell me when a task needs me, fails or finishes (also while this window is
          hidden)
        </label>
      </section>
    </div>
  );
}
