"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWindowStore, type WindowState } from "@/components/window-manager";
import { useAgentStore } from "./agentStore";
import {
  EMPTY_STATE_NOTICE_MS,
  TASK_SETTLE_MS,
  TASK_WORKING_MS,
  pickCannedAnnotation,
} from "./constants";

/**
 * The primary AI input surface: a floating pill, bottom-center of the
 * screen, matching the dock's frosted `bg-surface-elevated/70` +
 * `backdrop-blur-xl` chrome treatment (see Dock.tsx). Sits in the same
 * `z-chrome` layer as the dock.
 *
 * This component also owns the whole mocked demo sequence's orchestration
 * (reading the focused window, flipping `controlledBy`, driving
 * agentStore's cursor/annotation/task state on a timer) since it's the
 * one place the sequence begins. Every other ai-layer component only ever
 * READS agentStore reactively — this is the one writer of the
 * "working -> completed -> idle" timeline.
 *
 * Deliberately generic: it never reaches into a specific app's DOM. It
 * only reads the focused window's id/position/size from `windowStore`'s
 * public surface, so the exact same code path works whether the focused
 * window is a real future app or today's registry-fallback "No app is
 * registered for X" placeholder.
 */
export function CommandBar() {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const pillRef = useRef<HTMLFormElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const setCommandBarAnchor = useAgentStore((s) => s.setCommandBarAnchor);
  const startTask = useAgentStore((s) => s.startTask);
  const completeCurrentTask = useAgentStore((s) => s.completeCurrentTask);
  const clearCurrentTask = useAgentStore((s) => s.clearCurrentTask);
  const setCursorTarget = useAgentStore((s) => s.setCursorTarget);
  const setAnnotation = useAgentStore((s) => s.setAnnotation);
  // Not just `status === "working"` — this stays true through the brief
  // "completed" settle window too (see constants.ts's TASK_SETTLE_MS doc
  // comment: "...before the sequence resets to idle and the next submit is
  // allowed"). Gating on "working" alone would let a new submit land while
  // the previous task is still sitting on "completed", overwriting
  // `currentTask` out from under that task's still-pending
  // `clearCurrentTask` timeout — which would then null out the NEW task's
  // in-flight state early (badge/presence ring flashing back to idle while
  // its cursor/annotation are still mid-flight for the new task).
  const isBusy = useAgentStore((s) => s.currentTask !== null);

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

  function scheduleTimeout(fn: () => void, ms: number) {
    const id = setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }

  function runAgentSequence(win: WindowState, prompt: string) {
    const task = startTask({ windowId: win.id, prompt });
    useWindowStore.getState().setWindowControlledBy(win.id, "ai", task.id);

    const center = {
      x: win.position.x + win.size.width / 2,
      y: win.position.y + win.size.height / 2,
    };
    setCursorTarget(center);
    setAnnotation({
      message: pickCannedAnnotation(),
      position: { x: center.x, y: win.position.y },
    });

    scheduleTimeout(() => {
      completeCurrentTask();
      useWindowStore.getState().setWindowControlledBy(win.id, "human");
      setAnnotation(null);
      setCursorTarget(null);

      scheduleTimeout(clearCurrentTask, TASK_SETTLE_MS);
    }, TASK_WORKING_MS);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || isBusy) return;

    // Operate purely against whatever window happens to be focused right
    // now — a one-off, non-reactive read via getState(), not a subscribed
    // selector, since this only matters at the moment of submit.
    const windows = useWindowStore.getState().windows;
    const focused = Object.values(windows).find((w) => w.isFocused);
    if (!focused) {
      setNotice("Open an app first, then ask again.");
      scheduleTimeout(() => setNotice(null), EMPTY_STATE_NOTICE_MS);
      return;
    }

    setValue("");
    runAgentSequence(focused, prompt);
  }

  return (
    <div className="absolute inset-x-0 bottom-6 z-[var(--z-chrome)] flex flex-col items-center gap-2">
      {/* Plain conditional mount, deliberately not animated via
          framer-motion's AnimatePresence/`exit` — see AICursor.tsx's doc
          comment: that mechanism didn't reliably unmount nodes in this
          project's React 19 + motion setup. */}
      {notice && (
        <p className="bg-surface-elevated/90 text-ink-muted shadow-float-sm rounded-pill border-border/60 border px-3.5 py-1.5 text-[12px] font-medium backdrop-blur-xl">
          {notice}
        </p>
      )}

      <form
        ref={pillRef}
        onSubmit={handleSubmit}
        className="border-border/60 bg-surface-elevated/70 shadow-float rounded-pill flex w-[min(34rem,90vw)] items-center gap-2 border py-2 pr-2 pl-4 backdrop-blur-xl"
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isBusy}
          placeholder={isBusy ? "Working…" : "Ask something…"}
          aria-label="Ask the AI agent"
          className={cn(
            "text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-sm outline-none",
            "disabled:cursor-not-allowed",
          )}
        />
        <IconButton
          type="submit"
          aria-label="Send"
          variant="solid"
          size="md"
          disabled={!value.trim() || isBusy}
        >
          <PaperPlaneRightIcon size={17} weight="fill" />
        </IconButton>
      </form>
    </div>
  );
}
