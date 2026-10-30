"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { motion } from "motion/react";
import {
  ArrowUpIcon,
  CircleNotchIcon,
  SparkleIcon,
  StarIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { easeEntrance, easeExit } from "@/lib/motion";
import { isFocusBarShortcut } from "@/lib/focusKeys";
import { useWindowStore, type WindowState } from "@/components/window-manager";
import { launchBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { useTasksNav } from "@/components/apps/tasks-app/tasksNavStore";
import { resolvePmoIntent, type PmoIntent } from "@/lib/ai-runtime/pmoIntent";
import { prepareTaskSummary } from "@/lib/ai-runtime/pmoReply";
import { resolveLocalIntent, type LocalIntent } from "@/lib/ai-runtime/localIntent";
import { planText, splitSteps } from "@/lib/ai-runtime/steps";
import { logCommand, usePreferences } from "@/lib/preferences/preferencesStore";
import { recentPrompts, type CommandLogEntry } from "@/lib/preferences/schema";
import { completeFrom, suggestionsFor } from "./barSuggestions";
import { BarActionCard } from "./BarActionCard";
import { showMeFor } from "./barLinks";
import { openOrFocusBuiltInApp } from "@/components/taskbar/launchBuiltInApp";
import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { useStaffNav } from "@/components/apps/staff-app/staffNavStore";
import { ModelHealthChip } from "./ModelHealthChip";
import { runLocalCommand } from "./localCommands";
import { toast } from "@/lib/notifications/toastStore";
import {
  planOpenApp,
  resolveOpenIntent,
  resolveWindowTarget,
  type AiAppId,
} from "@/lib/ai-runtime/windowIntent";
import {
  createNote,
  deleteNote,
  getNotes,
  noteTitle,
  updateNote,
} from "@/components/apps/notes-app/notesStore";
import type {
  AiCommandAction,
  AiCommandRequest,
  AiCommandResult,
} from "@/app/api/ai/command/types";
import { useAgentStore } from "./agentStore";
import { ACTION_HOLD_MS, EMPTY_STATE_NOTICE_MS, TASK_SETTLE_MS } from "./constants";
import { placeholderFor } from "./barText";

/** Client-side safety net on top of the route's own internal timeout (see
 *  route.ts's REQUEST_TIMEOUT_MS / WAKE_TIMEOUT_MS: 180 s when the command has
 *  to wake the sleeping model) — deliberately a little longer, so the route's
 *  own timeout is always what actually fires first; this only guards against
 *  the request somehow hanging past that. */
const CLIENT_TIMEOUT_MS = 185_000;

type ApplyResult =
  { ok: true; summary: string; targetWindowId?: string } | { ok: false; reason: string };

const APP_TITLES = {
  files: "Files",
  notes: "Notes",
  browser: "Browser",
  tasks: "Tasks",
  "app-store": "App Store",
  "pmo-todo": "PMO To-Do",
  staff: "Staff Management",
  dashboard: "Dashboard",
  templates: "Templates",
  "pmo-toolkit": "PMO Toolkit",
  ...Object.fromEntries(toolApps.map((t) => [t.id, t.title])),
} as Record<AiAppId, string>;

/** The "Show me" link under an answer: opens the app behind it, filtered. */
function showMeAction(intent: PmoIntent | LocalIntent | undefined) {
  const link = showMeFor(intent);
  if (!link) return undefined;
  const { target } = link;
  return {
    label: link.label,
    run: () => {
      if (target.app === "pmo-todo") {
        openOrFocusBuiltInApp("pmo-todo");
        useRemindersStore.getState().requestOpen(null, { filter: target.filter });
      } else if (target.app === "staff") {
        useStaffNav.getState().requestOpen({ tab: "timeoff", timeOffStatus: "" });
        openOrFocusBuiltInApp("staff");
      } else {
        if (target.taskId) useTasksNav.getState().requestDetail(target.taskId);
        openOrFocusBuiltInApp("tasks");
      }
    },
  };
}

/** Opens an app, or raises its existing window instead of piling up another. */
function openOrFocusApp(appId: AiAppId): ApplyResult {
  const windowStore = useWindowStore.getState();
  const plan = planOpenApp(appId, Object.values(windowStore.windows));
  if (plan.type === "focus") {
    windowStore.restoreWindow(plan.windowId);
    return {
      ok: true,
      summary: `Focusing ${APP_TITLES[appId]}…`,
      targetWindowId: plan.windowId,
    };
  }
  const targetWindowId =
    launchBuiltInApp(appId) ??
    windowStore.openWindow(appId, { title: APP_TITLES[appId] });
  return { ok: true, summary: `Opening ${APP_TITLES[appId]}…`, targetWindowId };
}

/** Stands in for the focused window when the desktop is empty. */
const DESKTOP_CONTEXT = { id: "desktop", title: "Desktop" } as const;
/**
 * Applies a validated action decision to `notesStore` and returns a short,
 * human-readable summary of what actually happened (used for both the
 * annotation bubble and the eventual TaskList entry — see CommandBar's
 * doc comment). The route already checked the target id against the notes
 * list it was SENT, but real inference isn't instant, so this re-checks
 * against the CURRENT store right before acting, in case a note was
 * created/deleted from elsewhere while the request was in flight.
 *
 * An if-chain rather than a switch: TypeScript narrows `action.arguments`
 * fully at each step this way, including the final, unconditional branch
 * for "delete_note" (the only name left once the other two are ruled out).
 */
function applyAgentAction(action: AiCommandAction): ApplyResult {
  if (action.name === "create_note") {
    const note = createNote(action.arguments.content);
    return { ok: true, summary: `Creating a note: "${noteTitle(note.content)}"…` };
  }

  if (action.name === "update_note") {
    const existing = getNotes().find((n) => n.id === action.arguments.id);
    if (!existing) {
      return { ok: false, reason: "The note the AI tried to update no longer exists." };
    }
    updateNote(action.arguments.id, action.arguments.content, "assistant");
    return { ok: true, summary: `Updating "${noteTitle(existing.content)}"…` };
  }

  if (action.name === "delete_note") {
    const existing = getNotes().find((n) => n.id === action.arguments.id);
    if (!existing) {
      return { ok: false, reason: "The note the AI tried to delete no longer exists." };
    }
    deleteNote(action.arguments.id, "assistant");
    return {
      ok: true,
      summary: `Deleting "${noteTitle(existing.content)}" (Undo in Notes)…`,
    };
  }

  const windowStore = useWindowStore.getState();
  if (action.name === "open_app") return openOrFocusApp(action.arguments.appId);

  if (action.name === "prepare_task") {
    // Opens Tasks and asks that task's card to show its Run form; a person adds the
    // files and presses Run, so nothing starts (or sends) on its own.
    const opened = openOrFocusApp("tasks");
    if (!opened.ok) return opened;
    useTasksNav.getState().requestRun(action.arguments.taskId);
    const summary = prepareTaskSummary(action.arguments.taskId);
    // The bubble fades quickly; a toast tells someone who looked away why Tasks appeared.
    toast({ key: "prepare-task", tone: "info", message: summary, durationMs: 8_000 });
    return { ...opened, summary };
  }

  const target = resolveWindowTarget(
    action.arguments.id,
    Object.values(windowStore.windows),
  );
  if (!target) {
    return { ok: false, reason: "The window the AI tried to control no longer exists." };
  }
  if (target.kind === "open-app") {
    return action.name === "focus_window"
      ? openOrFocusApp(target.appId)
      : { ok: false, reason: "That app isn't open." };
  }
  const windowId = target.id;
  if (action.name === "focus_window") windowStore.focusWindow(windowId);
  if (action.name === "minimize_window") windowStore.minimizeWindow(windowId);
  if (action.name === "maximize_window") windowStore.maximizeWindow(windowId);
  if (action.name === "close_window") windowStore.closeWindow(windowId);

  const labels = {
    focus_window: "Focusing",
    minimize_window: "Minimizing",
    maximize_window: "Maximizing",
    close_window: "Closing",
  } as const;
  return {
    ok: true,
    summary: `${labels[action.name]} a window…`,
    targetWindowId: windowId,
  };
}

/** Where a plain conversational reply's annotation bubble anchors — just
 *  above the command bar pill itself, since (unlike an action) there's no
 *  window for the AI to be "doing something" to. Falls back the same way
 *  AICursor.tsx's own `home` point does if measured before CommandBar's
 *  layout effect has ever run. */
function messageAnnotationPoint(): { x: number; y: number } {
  const anchor = useAgentStore.getState().commandBarAnchor;
  const point = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight - 48 };
  return { x: point.x, y: point.y - 28 };
}

/**
 * The primary AI input surface: a floating frosted-glass pill, bottom-center
 * of the screen, in the same `glass` chrome as the dock (see Dock.tsx) and the
 * same `z-chrome` layer. It widens while focused, the send button turns into
 * an accent orb once there is something to send, and a rotating `ai-ring`
 * border runs around it while the AI is thinking or working. While focused
 * and empty it offers a few starter-prompt chips above the bar.
 *
 * The full-width wrapper is `pointer-events-none` (only the bar, the chips
 * and the notice re-enable pointer events), so the strip beside the pill no
 * longer swallows clicks meant for windows underneath.
 *
 * This component owns the whole real agent sequence's orchestration
 * (reading the focused window, calling `/api/ai/command`, flipping
 * `controlledBy`, driving agentStore's cursor/annotation/task state) since
 * it's the one place the sequence begins. Every other ai-layer component
 * only ever READS agentStore reactively — this is the one writer of the
 * "thinking -> working/completed -> idle" timeline.
 *
 * Mostly app-agnostic — it only reads the focused window's id/appId/
 * position/size from `windowStore`'s public surface, so the same code path
 * works for any focused app. The one deliberate exception: when the
 * focused app is Notes (`appId === "notes"`), this also reads/writes
 * `notesStore` directly — gathering existing notes as tool-call context
 * before the request (see `runAgentCommand` below), and applying a
 * validated create/update/delete decision after the request comes back
 * (see `applyNoteAction` above). That's the intended integration point
 * (see notesStore.ts's own doc comment), not a layering violation — every
 * other app still gets only a plain conversational reply, no action
 * capability, until a later pass gives it an equivalent store to hand the
 * same way.
 */
export function CommandBar() {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // True while focus is anywhere in the bar or its chips — what shows the
  // starter chips (focus moving from the input to a chip must not hide them).
  const [focusWithin, setFocusWithin] = useState(false);
  // Set while the first answer has to wake the sleeping local model (see runAgentCommand).
  const [wakingSince, setWakingSince] = useState<number | null>(null);
  const [wakeElapsed, setWakeElapsed] = useState(0);
  // Position in the history while walking it with the arrow keys (-1 = not walking).
  const [historyIndex, setHistoryIndex] = useState(-1);
  const commandLog = usePreferences((s) => s.commandLog);
  const favourites = usePreferences((s) => s.favourites);
  const focusedAppId = useWindowStore(
    (s) => Object.values(s.windows).find((w) => w.isFocused)?.appId ?? null,
  );
  // Remembers the last non-null notice so the pill can fade out still
  // showing its message instead of blanking the instant `notice` clears —
  // same purpose as AIAnnotationBubble.tsx's `lastAnnotationRef`.
  const lastNoticeRef = useRef<string | null>(null);
  const pillRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Steps still to run after the current one ("open Tasks, then what's overdue?").
  const chainRef = useRef<string[]>([]);
  const submitPromptRef = useRef<
    (prompt: string, clear: boolean, inChain?: boolean) => void
  >(() => {});
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Bumped on every submit; a scheduled callback checks it's still current
  // before touching agentStore, so a stale in-flight request can never
  // stomp on a NEWER task's state. `isBusy` already prevents overlapping
  // submits today, so in practice this is a defensive belt-and-suspenders
  // guard rather than something that fires — same reasoning as
  // useEngineLauncher.ts's own `tokenRef`.
  const taskTokenRef = useRef(0);

  const setCommandBarAnchor = useAgentStore((s) => s.setCommandBarAnchor);
  const startTask = useAgentStore((s) => s.startTask);
  const setTaskStatus = useAgentStore((s) => s.setTaskStatus);
  const completeCurrentTask = useAgentStore((s) => s.completeCurrentTask);
  const clearCurrentTask = useAgentStore((s) => s.clearCurrentTask);
  const setCursorTarget = useAgentStore((s) => s.setCursorTarget);
  const setAnnotation = useAgentStore((s) => s.setAnnotation);
  const currentStatus = useAgentStore((s) => s.currentTask?.status ?? null);
  // Not just `status === "thinking"` — this stays true through "working"
  // and the brief "completed" settle window too (see constants.ts's
  // TASK_SETTLE_MS doc comment: "...before the sequence resets to idle and
  // the next submit is allowed"). Gating on one status alone would let a
  // new submit land while the previous task is still settling, overwriting
  // `currentTask` out from under that task's still-pending
  // `clearCurrentTask` timeout — which would then null out the NEW task's
  // in-flight state early (badge/presence ring flashing back to idle while
  // its cursor/annotation are still mid-flight for the new task).
  const isBusy = currentStatus !== null;
  // The ring is for the AI actually doing something, not the brief
  // "completed" settle window.
  const isWorking = currentStatus === "thinking" || currentStatus === "working";

  // Measure this pill's on-screen center so AICursor knows where to glide
  // FROM (see agentStore's `commandBarAnchor` doc comment). Re-measured on
  // resize since the pill is centered via CSS, not pinned to a fixed pixel
  // position.
  useEffect(() => {
    function measure() {
      const el = pillRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCommandBarAnchor({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [setCommandBarAnchor]);

  // Any timer scheduled below is tracked here and cleared on unmount, so a
  // stray timeout never fires into a torn-down tree.
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, []);

  // Keeps the "waking the model" clock running.
  useEffect(() => {
    if (wakingSince === null) return;
    const id = setInterval(
      () => setWakeElapsed(Math.floor((Date.now() - wakingSince) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [wakingSince]);

  // The next step of a chain starts once the bar is free again.
  useEffect(() => {
    submitPromptRef.current = submitPrompt;
  });
  useEffect(() => {
    if (!isBusy && chainRef.current.length > 0) {
      const [next, ...rest] = chainRef.current;
      chainRef.current = rest;
      submitPromptRef.current(next, false, true);
    }
  }, [isBusy]);

  // Ctrl+Space from anywhere puts the cursor in the bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isFocusBarShortcut(event)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (notice) lastNoticeRef.current = notice;
  }, [notice]);

  function scheduleTimeout(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }

  function showNotice(message: string) {
    setNotice(message);
    scheduleTimeout(() => setNotice(null), EMPTY_STATE_NOTICE_MS);
  }

  async function runAgentCommand(
    win: WindowState | null,
    prompt: string,
    preset?: AiCommandResult,
    pmoIntent?: PmoIntent,
    localIntent?: LocalIntent,
  ) {
    const token = ++taskTokenRef.current;
    // A new question replaces the previous answer.
    setAnnotation(null);
    const context = win ?? DESKTOP_CONTEXT;
    const task = startTask({ windowId: context.id, prompt });
    let logged: Pick<CommandLogEntry, "tool" | "outcome" | "detail"> | null = null;

    const notesEnabled = win?.appId === "notes";
    const requestBody: AiCommandRequest = {
      prompt,
      focusedApp: { id: win?.appId ?? context.id, title: context.title },
      notes: notesEnabled
        ? getNotes().map((note) => ({ id: note.id, title: noteTitle(note.content) }))
        : undefined,
      windows: Object.values(useWindowStore.getState().windows).map((currentWindow) => ({
        id: currentWindow.id,
        appId: currentWindow.appId,
        title: currentWindow.title,
      })),
    };

    let result: AiCommandResult | undefined;
    if (preset) {
      result = preset;
    } else if (localIntent) {
      // To-do commands and run questions: planned from the data, confirmed by the person
      // where it matters (see localCommands.ts). null = not ours, the model gets it.
      const out = await runLocalCommand(localIntent, {
        appId: win?.appId ?? null,
        title: win?.title,
      });
      if (out) {
        result = out.result;
        logged = { tool: out.tool, outcome: out.outcome, detail: out.detail };
      }
    }
    if (!result) {
      let answered = false;
      if (!pmoIntent) {
        // Alongside the real request: if the model is asleep, the wait is a wake-up, say so.
        void (async () => {
          try {
            const res = await fetch("/api/ai/runtime", {
              signal: AbortSignal.timeout(4_000),
            });
            const status = (await res.json()) as { modelLoaded?: boolean };
            if (
              !answered &&
              token === taskTokenRef.current &&
              status.modelLoaded === false
            ) {
              setWakeElapsed(0);
              setWakingSince(Date.now());
            }
          } catch {
            // No status: keep the plain "Thinking…".
          }
        })();
      }
      try {
        // A PMO question the bar recognised itself is answered from the data by code
        // (no model, so it is instant and works with Ollama stopped); anything else
        // goes to the model.
        const res = await fetch(pmoIntent ? "/api/ai/pmo" : "/api/ai/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pmoIntent ?? requestBody),
          signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
        });
        result = (await res.json()) as AiCommandResult;
      } catch {
        result = {
          type: "error",
          kind: "unreachable",
          message: pmoIntent
            ? "Couldn't reach the AI OS server."
            : "Couldn't reach the local AI model.",
        };
      }
      answered = true;
      setWakingSince(null);
    }

    // A newer submit already started its own task while this one was in
    // flight (see `taskTokenRef`'s doc comment) — bail rather than acting
    // on behalf of a task that isn't the current one any more.
    if (token !== taskTokenRef.current) return;

    // The history (and the audit view): what was asked, which tool answered, how it ended.
    logCommand({
      at: Date.now(),
      prompt,
      tool:
        logged?.tool ??
        pmoIntent?.kind ??
        (preset ? "open_app" : result.type === "action" ? result.name : "model"),
      outcome:
        logged?.outcome ??
        (result.type === "error"
          ? "failed"
          : result.type === "action"
            ? "done"
            : "answered"),
      detail: logged?.detail ?? "",
    });

    if (result.type === "error") {
      chainRef.current = [];
      clearCurrentTask();
      showNotice(result.message);
      return;
    }

    if (logged?.outcome === "cancelled") chainRef.current = [];

    if (result.type === "message") {
      completeCurrentTask(result.text);
      // The answer stays on screen until it is dismissed; only the bar's busy state settles.
      setAnnotation({
        message: result.text,
        position: messageAnnotationPoint(),
        sticky: true,
        action: showMeAction(pmoIntent ?? localIntent),
      });
      scheduleTimeout(clearCurrentTask, TASK_SETTLE_MS);
      return;
    }

    // result.type === "action" — apply it before touching any of the
    // window-takeover choreography, so a note/window that's vanished out
    // from under us never leaves the window stuck
    // "AI-controlled" with nothing actually happening.
    const applied = applyAgentAction(result);
    if (!applied.ok) {
      clearCurrentTask();
      showNotice(applied.reason);
      return;
    }

    setTaskStatus("working");
    const targetWindowId = applied.targetWindowId ?? win?.id;
    const targetWindow = targetWindowId
      ? useWindowStore.getState().windows[targetWindowId]
      : undefined;
    if (targetWindow && targetWindowId) {
      useWindowStore.getState().setWindowControlledBy(targetWindowId, "ai", task.id);
    }
    const cursorWindow = targetWindow ?? (targetWindowId === win?.id ? win : undefined);
    const center = {
      x: cursorWindow
        ? cursorWindow.position.x + cursorWindow.size.width / 2
        : messageAnnotationPoint().x,
      y: cursorWindow
        ? cursorWindow.position.y + cursorWindow.size.height / 2
        : messageAnnotationPoint().y,
    };
    setCursorTarget(center);
    setAnnotation({
      message: applied.summary,
      position: { x: center.x, y: cursorWindow?.position.y ?? center.y },
    });

    scheduleTimeout(() => {
      completeCurrentTask(applied.summary);
      if (targetWindow && targetWindowId) {
        useWindowStore.getState().setWindowControlledBy(targetWindowId, "human");
      }
      setAnnotation(null);
      setCursorTarget(null);
      scheduleTimeout(clearCurrentTask, TASK_SETTLE_MS);
    }, ACTION_HOLD_MS);
  }

  /** The one submit path: typing + Enter and the starter chips both end up
   *  here. */
  function submitPrompt(rawPrompt: string, clearInput: boolean, inChain = false) {
    const prompt = rawPrompt.trim();
    if (!prompt || isBusy) return;

    // "Open Tasks, then what's overdue?": show the plan, then run the steps one by one.
    if (!inChain) {
      const steps = splitSteps(prompt, (step) =>
        Boolean(
          resolveOpenIntent(step) || resolvePmoIntent(step) || resolveLocalIntent(step),
        ),
      );
      if (steps) {
        chainRef.current = steps.slice(1);
        toast({ key: "plan", message: planText(steps), durationMs: 6_000 });
        submitPrompt(steps[0], clearInput, true);
        return;
      }
      chainRef.current = [];
    }
    // Operate purely against whatever window happens to be focused right
    // now — a one-off, non-reactive read via getState(), not a subscribed
    // selector, since this only matters at the moment of submit.
    const windows = useWindowStore.getState().windows;
    const focused = Object.values(windows).find((w) => w.isFocused) ?? null;

    if (clearInput) setValue("");

    // "Open Notes" (the starter chips) needs no model: open it directly.
    const quickApp = resolveOpenIntent(prompt);
    if (quickApp) {
      void runAgentCommand(focused, prompt, {
        type: "action",
        name: "open_app",
        arguments: { appId: quickApp },
      });
      return;
    }

    // "Remind me to ...", "snooze ...", "did the backlog report run?": done from the app's
    // own data, with a confirmation card where it matters. Anything it declines falls through.
    const localIntent = resolveLocalIntent(prompt);
    if (localIntent) {
      void runAgentCommand(focused, prompt, undefined, undefined, localIntent);
      return;
    }

    // "Who's off next Monday?", "what's overdue?", "prepare the aging report": answered
    // from the real Staff, PMO and task data by code, not by asking the model.
    const pmoIntent = resolvePmoIntent(prompt);
    if (pmoIntent) {
      void runAgentCommand(focused, prompt, undefined, pmoIntent);
      return;
    }

    void runAgentCommand(focused, prompt);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitPrompt(value, true);
  }

  function handleFocus() {
    setFocusWithin(true);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocusWithin(false);
  }

  const canSend = Boolean(value.trim()) && !isBusy;
  const recent = recentPrompts(commandLog);
  const completions =
    value === ""
      ? []
      : completeFrom(value, [
          ...favourites,
          ...recent,
          ...suggestionsFor(focusedAppId, []).map((s) => s.text),
        ]);
  const chips: { text: string; favourite: boolean; complete: boolean }[] =
    value === ""
      ? suggestionsFor(focusedAppId, favourites).map((s) => ({ ...s, complete: false }))
      : completions.map((text) => ({ text, favourite: false, complete: true }));
  const showSuggestions = focusWithin && !isBusy && chips.length > 0;
  const typedIsFavourite = favourites.some(
    (f) => f.toLowerCase() === value.trim().toLowerCase(),
  );

  function handleInputKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && completions.length > 0 && !event.shiftKey) {
      event.preventDefault();
      setValue(completions[0]);
      return;
    }
    // Up / Down walk through earlier commands.
    if (event.key === "ArrowUp" && recent.length > 0) {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, recent.length - 1);
      setHistoryIndex(next);
      setValue(recent[next]);
    } else if (event.key === "ArrowDown" && historyIndex >= 0) {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(next < 0 ? "" : recent[next]);
    }
  }

  // Nothing has ever been shown yet — nothing to fade out from either, so
  // there's genuinely nothing to mount (same reasoning as
  // AIAnnotationBubble.tsx's own `display` gate).
  const displayNotice = notice ?? lastNoticeRef.current;

  return (
    <div
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="pointer-events-none absolute inset-x-0 bottom-[26px] z-[var(--z-chrome)] flex flex-col items-center gap-2"
    >
      {/* Stays mounted once shown and animates opacity/position rather than
          mounting/unmounting per notice via AnimatePresence's `exit`, which
          isn't reliable in this project's React 19 + motion setup — see
          AICursor.tsx's doc comment for why. */}
      <BarActionCard />
      <ModelHealthChip active={focusWithin && !isBusy} />

      {displayNotice && (
        <motion.p
          initial={false}
          animate={{ opacity: notice ? 1 : 0, y: notice ? 0 : 4 }}
          transition={{
            duration: notice ? 0.16 : 0.12,
            ease: notice ? easeEntrance : easeExit,
          }}
          aria-hidden={!notice}
          role="status"
          className="glass rounded-chip text-ink-soft px-3.5 py-1.5 text-[12.5px] font-semibold"
        >
          {displayNotice}
        </motion.p>
      )}

      {/* Starter chips: out of flow (absolute, above the bar) so showing
          them never moves the bar. Always mounted; hidden + non-interactive
          unless focused-and-empty. `onMouseDown` keeps the input focused
          through the click. */}
      <div
        aria-hidden={!showSuggestions}
        inert={!showSuggestions}
        className={cn(
          "absolute bottom-[calc(100%+0.5rem)] left-1/2 flex w-max max-w-[94vw] -translate-x-1/2 flex-wrap justify-center gap-2",
          "ease-smooth transition-[opacity,transform] duration-[400ms]",
          showSuggestions
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2.5 opacity-0",
        )}
      >
        {chips.map(({ text, favourite, complete }) => (
          <span key={text} className="inline-flex items-center">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (complete) {
                  setValue(text);
                  inputRef.current?.focus();
                } else {
                  submitPrompt(text, false);
                }
              }}
              className={cn(
                "glass sweep rounded-chip text-ink-soft inline-flex h-9 items-center gap-[7px] px-[15px] text-[13px] font-semibold whitespace-nowrap",
                "transition-ui hover:text-accent-ink active:scale-95",
                favourite && "rounded-r-none pr-2.5",
              )}
            >
              {favourite && <StarIcon size={14} weight="fill" className="text-amber" />}
              {text}
            </button>
            {favourite && (
              <button
                type="button"
                aria-label={`Unpin ${text}`}
                title="Unpin"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => usePreferences.getState().toggleFavourite(text)}
                className="glass rounded-chip text-ink-muted hover:text-ink inline-flex h-9 w-7 items-center justify-center rounded-l-none"
              >
                <XIcon size={12} aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>

      <form
        ref={pillRef}
        onSubmit={handleSubmit}
        className={cn(
          "glass ai-ring rounded-bar h-command-bar pointer-events-auto flex items-center gap-3 py-0 pr-[9px] pl-5",
          "ease-smooth w-[min(35rem,90vw)] transition-[width,box-shadow] duration-500",
          "focus-within:w-[min(41.25rem,94vw)] focus-within:shadow-[0_0_0_5px_var(--color-accent-soft),0_22px_44px_-14px_var(--sh)]",
          !isWorking && "[--ai-ring-opacity:0] [--ai-ring-state:paused]",
        )}
      >
        <SparkleIcon
          size={18}
          weight="duotone"
          aria-hidden
          className="text-accent-ink shrink-0"
        />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleInputKey}
          disabled={isBusy}
          placeholder={placeholderFor(currentStatus, {
            waking: wakingSince !== null,
            elapsedSeconds: wakeElapsed,
          })}
          aria-label="Ask the AI agent"
          className={cn(
            "text-ink placeholder:text-ink-muted h-full min-w-0 flex-1 bg-transparent text-[15.5px] font-medium outline-none",
            "disabled:cursor-not-allowed",
          )}
        />
        {value.trim() !== "" && !isBusy && (
          <button
            type="button"
            aria-label={typedIsFavourite ? "Unpin this command" : "Pin this command"}
            title={typedIsFavourite ? "Unpin this command" : "Pin as a quick command"}
            aria-pressed={typedIsFavourite}
            onClick={() => usePreferences.getState().toggleFavourite(value)}
            className="text-ink-muted hover:text-ink rounded-control grid h-8 w-8 shrink-0 place-items-center"
          >
            <StarIcon
              size={17}
              weight={typedIsFavourite ? "fill" : "regular"}
              aria-hidden
            />
          </button>
        )}
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className={cn(
            "rounded-orb grid h-[42px] w-[42px] shrink-0 place-items-center",
            "ease-spring transition-[background-color,color,transform] duration-300",
            "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
            canSend
              ? "bg-accent text-accent-contrast hover:scale-[1.08] hover:-rotate-6"
              : "bg-chip-strong text-ink-muted cursor-default",
          )}
        >
          {isBusy ? (
            <CircleNotchIcon size={18} weight="bold" className="animate-spin" />
          ) : (
            <ArrowUpIcon size={18} weight="bold" />
          )}
        </button>
      </form>
    </div>
  );
}
