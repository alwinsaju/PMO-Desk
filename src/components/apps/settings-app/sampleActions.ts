"use client";

import {
  clearCancelled,
  createTodo,
  fetchState,
  patchTodo,
} from "@/components/apps/pmo-todo-app/api";
import {
  SAMPLE_TAG,
  SAMPLE_TODOS,
  addDaysTo,
  isSampleEmployee,
  isSampleTodo,
  sampleEmployeeInputs,
  sampleTimeOff,
} from "@/lib/platform/sampleData";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import { todayIso } from "@/lib/staff/dates";
import { createEmployee } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import { createTimeOff } from "@/lib/staff/timeoff";

export type SampleResult =
  { ok: true; todos: number; people: number } | { ok: false; reason: string };

/** Add the sample to-dos, people and time off. They are ordinary records, marked so they can be removed. */
export async function loadSampleData(): Promise<SampleResult> {
  const today = todayIso(new Date());
  const staff = useStaffStore.getState();
  const people = sampleEmployeeInputs().map((input) => createEmployee(input));
  const added = await staff.commit("employees", { upsert: people });
  if (!added.ok) return { ok: false, reason: added.reason };
  const now = new Date().toISOString();
  const leave = sampleTimeOff(
    people.map((p) => p.id),
    today,
  ).map((l) => createTimeOff(l, now));
  const leaveAdded = await staff.commit("timeoff", {
    upsert: leave.map((l) => (l.status === "approved" ? { ...l, decidedAt: now } : l)),
  });
  if (!leaveAdded.ok) return { ok: false, reason: leaveAdded.reason };

  let todos = 0;
  for (const sample of SAMPLE_TODOS) {
    const reply = await createTodo({
      ...emptyDraft(sample.title),
      description: sample.description,
      owner: { name: null, email: null, isMe: true },
      dueAt: sample.dueInDays === null ? null : addDaysTo(today, sample.dueInDays),
      priority: sample.priority,
      waitingOn: sample.waitingOn,
      tags: [SAMPLE_TAG],
    });
    if (!reply.ok) return { ok: false, reason: reply.reason };
    todos += 1;
  }
  return { ok: true, todos, people: people.length };
}

/** Remove exactly what loadSampleData added; nothing else is touched. */
export async function removeSampleData(): Promise<SampleResult> {
  const state = await fetchState().catch(() => null);
  if (!state) return { ok: false, reason: "Could not reach the app server." };
  const ids = state.todos.filter(isSampleTodo).map((t) => t.id);
  for (const id of ids) {
    const cancelled = await patchTodo(id, { status: "cancelled" });
    if (!cancelled.ok) return { ok: false, reason: cancelled.reason };
  }
  if (ids.length > 0) {
    const cleared = await clearCancelled(ids);
    if (!cleared.ok) return { ok: false, reason: cleared.reason };
  }

  const staff = useStaffStore.getState();
  const people = staff.employees.filter(isSampleEmployee).map((e) => e.id);
  if (people.length > 0) {
    const leave = staff.timeOff
      .filter((r) => people.includes(r.employeeId))
      .map((r) => r.id);
    if (leave.length > 0) {
      const gone = await staff.commit("timeoff", { remove: leave });
      if (!gone.ok) return { ok: false, reason: gone.reason };
    }
    const removed = await staff.commit("employees", { remove: people });
    if (!removed.ok) return { ok: false, reason: removed.reason };
  }
  return { ok: true, todos: ids.length, people: people.length };
}
