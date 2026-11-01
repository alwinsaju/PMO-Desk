"use client";

import { InfoIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { dequeue, type QueuedSend } from "@/lib/tasks/sendQueue";
import {
  WEEKDAYS,
  dayLabel,
  defaultSchedule,
  nextOccurrence,
  pendingOccurrence,
  type TaskSchedule,
} from "@/lib/tasks/taskSchedule";
import { useTasksPrefs } from "@/lib/tasks/tasksPrefsStore";
import { Note } from "../pmo-todo-app/parts";
import { sendTask } from "./api";
import type { Task } from "./types";

const SELECT =
  "rounded-control border-line bg-surface-elevated text-ink h-9 border px-2.5 text-[13px]";

const HEAD = "px-4 py-2.5 text-[11.5px] font-bold tracking-[0.06em] uppercase";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One workflow's schedule as a table row: how often, when it runs next, and whether to prepare it. */
function ScheduleRow({
  task,
  schedule,
  handledDay,
  onChange,
}: {
  task: Task;
  schedule: TaskSchedule | null;
  handledDay: string | undefined;
  onChange: (next: TaskSchedule | null) => void;
}) {
  const now = new Date();
  const next = schedule ? nextOccurrence(schedule, now) : null;
  const due = schedule ? pendingOccurrence(schedule, handledDay, now) : null;
  const set = (patch: Partial<TaskSchedule>) =>
    schedule && onChange({ ...schedule, ...patch });

  return (
    <tr data-testid="schedule-row" className="border-line border-t align-middle">
      <th
        scope="row"
        className="text-ink px-4 py-3 text-left text-[13.5px] font-semibold"
      >
        {task.displayName}
      </th>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`How often: ${task.displayName}`}
            className={SELECT}
            value={schedule?.cadence ?? "off"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "off") onChange(null);
              else
                onChange({
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
              onChange={(e) => set({ weekday: Number(e.target.value) })}
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
              onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
            </select>
          )}
          {schedule && (
            <input
              type="time"
              aria-label={`Time: ${task.displayName}`}
              className={SELECT}
              value={schedule.time}
              onChange={(e) => e.target.value && set({ time: e.target.value })}
            />
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-[13px]" data-testid="schedule-next">
        {next ? (
          <>
            <span className="text-ink">
              {dayLabel(next.day)}, {next.time}
            </span>
            {due && due.kind !== "none" && (
              <span className="text-amber block text-[12px] font-semibold">
                Not yet handled for {dayLabel(due.day)}
              </span>
            )}
          </>
        ) : (
          <>
            <span aria-hidden className="text-ink-faint">
              —
            </span>
            <span className="sr-only">Not scheduled</span>
          </>
        )}
      </td>
      <td className="px-4 py-3">
        {schedule && (
          <label className="text-ink-soft flex items-center gap-2 text-[12.5px] whitespace-nowrap">
            <input
              type="checkbox"
              checked={schedule.autoPrepare}
              onChange={(e) => set({ autoPrepare: e.target.checked })}
              className="accent-accent h-4 w-4"
            />
            Prepare it for me
          </label>
        )}
      </td>
    </tr>
  );
}

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
        <Note
          tone="warning"
          role="note"
          className="flex items-start gap-2.5"
          data-testid="schedule-caveat"
        >
          <InfoIcon size={16} weight="bold" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <strong>Schedules only run while AI OS is open.</strong> Anything that came
            due while it was closed is reported the next time it starts. A scheduled task
            can be prepared for you, but it always stops at the first review step; nothing
            is sent without your approval.
          </span>
        </Note>
        <div className="border-line bg-card rounded-card overflow-x-auto border">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-ink-muted">
                <th scope="col" className={HEAD}>
                  Workflow
                </th>
                <th scope="col" className={HEAD}>
                  Repeats
                </th>
                <th scope="col" className={HEAD}>
                  Next run
                </th>
                <th scope="col" className={HEAD}>
                  <span className="sr-only">Prepare</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <ScheduleRow
                  key={task.id}
                  task={task}
                  schedule={prefs.schedules.find((s) => s.taskId === task.id) ?? null}
                  handledDay={prefs.handled[task.id]}
                  onChange={(next) => setSchedule(task.id, next)}
                />
              ))}
            </tbody>
          </table>
        </div>
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
