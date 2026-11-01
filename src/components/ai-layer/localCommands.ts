"use client";

import { fetchTaskHistory, fetchTasks } from "@/components/apps/tasks-app/api";
import { createTodo, fetchState, patchTodo } from "@/components/apps/pmo-todo-app/api";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { continueRecurrence } from "@/components/apps/pmo-todo-app/recurHelper";
import { todayIso } from "@/lib/staff/dates";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import type { AiCommandResult } from "@/app/api/ai/command/types";
import { REPORT_TASKS, type RunLike } from "@/lib/dashboard/summary";
import {
  matchTodo,
  planLocalIntent,
  type ActionPlan,
  type Effect,
} from "@/lib/ai-runtime/barActions";
import type { LocalIntent } from "@/lib/ai-runtime/localIntent";
import { runInfoReply } from "@/lib/ai-runtime/runInfo";
import { EXPLAIN_NOTHING, EXPLAIN_UNKNOWN, explainApp } from "@/lib/ai-runtime/explain";
import { toast } from "@/lib/notifications/toastStore";
import { useFocusMode } from "@/lib/focusModeStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import type { CommandLogEntry } from "@/lib/preferences/schema";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import { useBarAction } from "./barActionStore";

export interface LocalOutcome {
  result: AiCommandResult;
  outcome: CommandLogEntry["outcome"];
  tool: string;
  detail: string;
}

const say = (
  text: string,
  outcome: LocalOutcome["outcome"],
  tool: string,
  detail = "",
): LocalOutcome => ({
  result: { type: "message", text },
  outcome,
  tool,
  detail,
});

const offline = (tool: string): LocalOutcome => ({
  result: {
    type: "error",
    kind: "unreachable",
    message: "Couldn't reach the PMO Desk server.",
  },
  outcome: "failed",
  tool,
  detail: "",
});

/** Carry out a confirmed effect; throws on a refusal so the caller can report it. */
async function perform(effect: Effect): Promise<void> {
  if (effect.op === "create") {
    const reply = await createTodo({
      ...emptyDraft(effect.title),
      owner: { name: null, email: null, isMe: true },
      dueAt: effect.dueAt,
    });
    if (!reply.ok) throw new Error(reply.reason);
    return;
  }
  if (effect.op === "patch") {
    const reply = await patchTodo(effect.todoId, effect.patch);
    if (!reply.ok) throw new Error(reply.reason);
    if ("status" in effect.patch && reply.nextOccurrence) {
      // A repeating to-do: the next one is created (or offered in the PMO window).
      await continueRecurrence(
        reply.todo,
        reply.nextOccurrence,
        todayIso(new Date()),
        () => {
          openOrFocusBuiltInApp("pmo-todo");
          useRemindersStore.getState().requestOpen(effect.todoId);
        },
      );
      return;
    }
    const undo =
      "status" in effect.patch ? { status: "open" as const } : { snoozedUntil: null };
    toast({
      key: `bar-${effect.todoId}`,
      message: "Done.",
      action: {
        label: "Undo",
        run: () => void patchTodo(effect.todoId, undo),
      },
    });
    return;
  }
  openOrFocusBuiltInApp("pmo-todo");
  useRemindersStore.getState().requestOpen(effect.todoId, { chaser: true });
}

async function runTodoCommand(
  intent: Exclude<LocalIntent, { kind: "run_info" | "explain" | "focus" }>,
): Promise<LocalOutcome | null> {
  const tool =
    intent.kind === "todo_action" ? `todo_action:${intent.action}` : intent.kind;
  let plan: ActionPlan;
  try {
    const state = await fetchState();
    // "close the report" may be about something other than a to-do: leave it to the model.
    if (
      intent.kind === "todo_action" &&
      intent.action === "done" &&
      matchTodo(state.todos, intent.query).kind === "none"
    ) {
      return null;
    }
    plan = planLocalIntent(intent, {
      todos: state.todos,
      today: state.today,
      now: new Date(state.serverTime),
      prefs: state.config.reminders,
    });
  } catch {
    return offline(tool);
  }
  if (plan.type === "say") return say(plan.text, "answered", tool);

  const ask = plan.confirmKey
    ? usePreferences.getState().confirmActions[plan.confirmKey]
    : false;
  if (ask) {
    const ok = await useBarAction
      .getState()
      .ask({ title: plan.title, detail: plan.detail, confirmLabel: plan.confirmLabel });
    if (!ok)
      return say("Okay, I left it alone.", "cancelled", tool, plan.detail.split("\n")[0]);
  }
  try {
    await perform(plan.effect);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "It could not be saved.";
    return {
      result: { type: "error", kind: "unreachable", message: reason },
      outcome: "failed",
      tool,
      detail: plan.detail.split("\n")[0],
    };
  }
  return say(plan.doneText, "done", tool, plan.detail.split("\n")[0]);
}

async function runRunInfo(
  intent: Extract<LocalIntent, { kind: "run_info" }>,
): Promise<LocalOutcome> {
  const tool = `run_info:${intent.question}`;
  let timeZone = "Asia/Kolkata";
  try {
    timeZone = (await fetchState()).config.reminders.timeZone;
  } catch {
    // The default zone is fine for dates.
  }
  let tasks: Awaited<ReturnType<typeof fetchTasks>> | null = null;
  try {
    tasks = await fetchTasks();
  } catch {
    tasks = null;
  }
  const histories: Record<string, readonly RunLike[] | undefined> = {};
  if (tasks) {
    const ids = intent.taskId ? [intent.taskId] : REPORT_TASKS.map((t) => t.id);
    await Promise.all(
      ids
        .filter((id) => tasks!.some((t) => t.id === id))
        .map(async (id) => {
          histories[id] = await fetchTaskHistory(id).catch(() => undefined);
        }),
    );
  }
  const text = runInfoReply(
    intent,
    {
      tasks: tasks?.map((t) => ({ id: t.id, displayName: t.displayName })) ?? null,
      histories,
    },
    new Date(),
    timeZone,
  );
  return say(text, "answered", tool, intent.taskId ?? "");
}

/** What the focused app is for, plus today's numbers for the PMO and the Dashboard. */
async function runExplain(focus: {
  appId: string | null;
  title?: string;
}): Promise<LocalOutcome> {
  const base = explainApp(focus.appId, focus.title);
  if (!focus.appId) return say(EXPLAIN_NOTHING, "answered", "explain");
  if (!base) return say(EXPLAIN_UNKNOWN, "answered", "explain", focus.appId);
  let live = "";
  if (focus.appId === "pmo-todo" || focus.appId === "dashboard") {
    try {
      const res = await fetch("/api/ai/pmo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pmo_status", topic: "summary" }),
      });
      const body = (await res.json()) as AiCommandResult;
      if (body.type === "message") live = `\n\nRight now:\n${body.text}`;
    } catch {
      // The description alone is still useful.
    }
  }
  return say(`${base}${live}`, "answered", "explain", focus.appId);
}

/** Run a recognised command; null = not for us (the model gets it instead). */
export function runLocalCommand(
  intent: LocalIntent,
  focus: { appId: string | null; title?: string } = { appId: null },
): Promise<LocalOutcome | null> {
  if (intent.kind === "explain") return runExplain(focus);
  if (intent.kind === "focus") {
    const mode = useFocusMode.getState();
    if (intent.minutes === 0) {
      mode.stop();
      return Promise.resolve(say("Focus mode is off.", "done", "focus"));
    }
    mode.start(intent.minutes);
    return Promise.resolve(
      say(
        `Focus mode is on for ${intent.minutes} minutes. The dock is hidden and notices are held back; say "stop focus" to end it.`,
        "done",
        "focus",
        `${intent.minutes} min`,
      ),
    );
  }
  return intent.kind === "run_info" ? runRunInfo(intent) : runTodoCommand(intent);
}
