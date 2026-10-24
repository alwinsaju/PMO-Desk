"use client";

import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { motion } from "motion/react";
import {
  ArrowUpIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  FolderIcon,
  NotePencilIcon,
  SparkleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { easeEntrance, easeExit } from "@/lib/motion";
import { useWindowStore, type WindowState } from "@/components/window-manager";
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
import {
  ACTION_HOLD_MS,
  EMPTY_STATE_NOTICE_MS,
  MESSAGE_HOLD_MS,
  TASK_SETTLE_MS,
} from "./constants";
import type { AgentTaskStatus } from "./types";

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
} as const;

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
    return { ok: true, summary: `Creating a note: "${noteTitle(note)}"…` };
  }

  if (action.name === "update_note") {
    const existing = getNotes().find((n) => n.id === action.arguments.id);
    if (!existing) {
      return { ok: false, reason: "The note the AI tried to update no longer exists." };
    }
    updateNote(action.arguments.id, action.arguments.content);
    return { ok: true, summary: `Updating "${noteTitle(existing)}"…` };
  }

  if (action.name === "delete_note") {
    const existing = getNotes().find((n) => n.id === action.arguments.id);
    if (!existing) {
      return { ok: false, reason: "The note the AI tried to delete no longer exists." };
    }
    deleteNote(action.arguments.id);
    return { ok: true, summary: `Deleting "${noteTitle(existing)}"…` };
  }

  const windowStore = useWindowStore.getState();
  if (action.name === "open_app") {
    const targetWindowId = windowStore.openWindow(action.arguments.appId, {
      title: APP_TITLES[action.arguments.appId],
    });
    return {
      ok: true,
      summary: `Opening ${APP_TITLES[action.arguments.appId]}…`,
      targetWindowId,
    };
  }

  if (!windowStore.windows[action.arguments.id]) {
    return { ok: false, reason: "The window the AI tried to control no longer exists." };
  }
  if (action.name === "focus_window") windowStore.focusWindow(action.arguments.id);
  if (action.name === "minimize_window") windowStore.minimizeWindow(action.arguments.id);
  if (action.name === "maximize_window") windowStore.maximizeWindow(action.arguments.id);
  if (action.name === "close_window") windowStore.closeWindow(action.arguments.id);

  const labels = {
    focus_window: "Focusing",
    minimize_window: "Minimizing",
    maximize_window: "Maximizing",
    close_window: "Closing",
  } as const;
  return {
    ok: true,
    summary: `${labels[action.name]} a window…`,
    targetWindowId: action.arguments.id,
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

/** Starter prompts offered above the bar while it is focused and empty.
 *  Clicking one submits it through the exact same path as typing + Enter
 *  (`submitPrompt`), so it gets the same focused-window check, the same
 *  `/api/ai/command` call and the same busy-gating. */
const SUGGESTIONS: { text: string; icon: Icon }[] = [
  { text: "Open Notes", icon: NotePencilIcon },
  { text: "Open Files", icon: FolderIcon },
  { text: "Open Tasks", icon: ClipboardTextIcon },
];

function placeholderFor(status: AgentTaskStatus | null): string {
  switch (status) {
    case "thinking":
      return "Thinking…";
    case "working":
      return "Working…";
    case "completed":
      return "Done…";
    case null:
      return "Ask AI to do something…";
  }
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
  // Remembers the last non-null notice so the pill can fade out still
  // showing its message instead of blanking the instant `notice` clears —
  // same purpose as AIAnnotationBubble.tsx's `lastAnnotationRef`.
  const lastNoticeRef = useRef<string | null>(null);
  const pillRef = useRef<HTMLFormElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Bumped on every submit; a scheduled callback checks it's still current
  // before touching agentStore, so a stale in-flight request can never
  // stomp on a NEWER task's state. `isBusy` already prevents overlapping
  // submits today, so in practice this is a defensive belt-and-suspenders
  // guard rather than something that fires — same reasoning as
  // useBackendLauncher.ts's own `tokenRef`.
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

  async function runAgentCommand(win: WindowState, prompt: string) {
    const token = ++taskTokenRef.current;
    const task = startTask({ windowId: win.id, prompt });

    const notesEnabled = win.appId === "notes";
    const requestBody: AiCommandRequest = {
      prompt,
      focusedApp: { id: win.appId, title: win.title },
      notes: notesEnabled
        ? getNotes().map((note) => ({ id: note.id, title: noteTitle(note) }))
        : undefined,
      windows: Object.values(useWindowStore.getState().windows).map((currentWindow) => ({
        id: currentWindow.id,
        appId: currentWindow.appId,
        title: currentWindow.title,
      })),
    };

    let result: AiCommandResult;
    try {
      const res = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
      result = (await res.json()) as AiCommandResult;
    } catch {
      result = {
        type: "error",
        kind: "unreachable",
        message: "Couldn't reach the local AI model.",
      };
    }

    // A newer submit already started its own task while this one was in
    // flight (see `taskTokenRef`'s doc comment) — bail rather than acting
    // on behalf of a task that isn't the current one any more.
    if (token !== taskTokenRef.current) return;

    if (result.type === "error") {
      clearCurrentTask();
      showNotice(result.message);
      return;
    }

    if (result.type === "message") {
      completeCurrentTask(result.text);
      setAnnotation({ message: result.text, position: messageAnnotationPoint() });
      scheduleTimeout(() => {
        setAnnotation(null);
        scheduleTimeout(clearCurrentTask, TASK_SETTLE_MS);
      }, MESSAGE_HOLD_MS);
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
    const targetWindowId = applied.targetWindowId ?? win.id;
    const targetWindow = useWindowStore.getState().windows[targetWindowId];
    if (targetWindow) {
      useWindowStore.getState().setWindowControlledBy(targetWindowId, "ai", task.id);
    }
    const cursorWindow = targetWindow ?? (targetWindowId === win.id ? win : undefined);
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
      if (targetWindow) {
        useWindowStore.getState().setWindowControlledBy(targetWindowId, "human");
      }
      setAnnotation(null);
      setCursorTarget(null);
      scheduleTimeout(clearCurrentTask, TASK_SETTLE_MS);
    }, ACTION_HOLD_MS);
  }

  /** The one submit path: typing + Enter and the starter chips both end up
   *  here. */
  function submitPrompt(rawPrompt: string, clearInput: boolean) {
    const prompt = rawPrompt.trim();
    if (!prompt || isBusy) return;

    // Operate purely against whatever window happens to be focused right
    // now — a one-off, non-reactive read via getState(), not a subscribed
    // selector, since this only matters at the moment of submit.
    const windows = useWindowStore.getState().windows;
    const focused = Object.values(windows).find((w) => w.isFocused);
    if (!focused) {
      showNotice("Open an app first, then ask again.");
      return;
    }

    if (clearInput) setValue("");
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
  const showSuggestions = focusWithin && !isBusy && value === "";

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
          "absolute bottom-[calc(100%+0.5rem)] left-1/2 flex -translate-x-1/2 gap-2",
          "ease-smooth transition-[opacity,transform] duration-[400ms]",
          showSuggestions
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2.5 opacity-0",
        )}
      >
        {SUGGESTIONS.map(({ text, icon: Glyph }) => (
          <button
            key={text}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => submitPrompt(text, false)}
            className={cn(
              "glass sweep rounded-chip text-ink-soft inline-flex h-9 items-center gap-[7px] px-[15px] text-[13px] font-semibold whitespace-nowrap",
              "transition-ui hover:text-accent-ink active:scale-95",
            )}
          >
            <Glyph size={15} weight="bold" />
            {text}
          </button>
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
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isBusy}
          placeholder={placeholderFor(currentStatus)}
          aria-label="Ask the AI agent"
          className={cn(
            "text-ink placeholder:text-ink-muted h-full min-w-0 flex-1 bg-transparent text-[15.5px] font-medium outline-none",
            "disabled:cursor-not-allowed",
          )}
        />
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
