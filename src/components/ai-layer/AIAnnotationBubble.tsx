"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { SparkleIcon, CopyIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { easeStandard } from "@/lib/motion";
import { toast } from "@/lib/notifications/toastStore";
import { useAgentStore } from "./agentStore";
import type { AgentAnnotation } from "./types";

/**
 * A frosted-glass callout (`glass-pop`) with a small accent badge, an "AI
 * AGENT" kicker and the message, plus a pointer tail, anchored to an arbitrary
 * screen position (the focused window's top edge, or just above the command
 * bar for a plain reply — see CommandBar's submit handler) rather than any
 * specific app's DOM. Shows the current task's short "what the AI is doing"
 * message.
 *
 * Portal-rendered to `document.body` for the same reason as AICursor: its
 * anchor point is in viewport coordinates, so it needs to escape whatever
 * stacking/overflow context its React parent happens to have.
 *
 * Like AICursor, this stays mounted and animates opacity rather than
 * mounting/unmounting via AnimatePresence's `exit` — see AICursor's doc
 * comment for why. `lastAnnotationRef` remembers the most recent non-null
 * annotation so the bubble fades out in place (at its last position, with
 * its last message) instead of snapping to an empty placeholder the
 * instant `annotation` goes back to null.
 */
export function AIAnnotationBubble() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const annotation = useAgentStore((s) => s.annotation);
  const lastAnnotationRef = useRef<AgentAnnotation | null>(null);
  useEffect(() => {
    if (annotation) lastAnnotationRef.current = annotation;
  }, [annotation]);

  const display = annotation ?? lastAnnotationRef.current;

  // Nothing has ever been shown yet — no sensible position to render at,
  // and nothing to fade out from, so there's genuinely nothing to mount.
  const isActive = annotation !== null;
  const sticky = isActive && annotation.sticky === true;

  // Esc dismisses an answer that is waiting to be read.
  useEffect(() => {
    if (!sticky) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useAgentStore.getState().setAnnotation(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sticky]);

  if (!mounted || !display) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(display.message);
      toast({
        key: "copied-answer",
        tone: "success",
        message: "Answer copied",
        durationMs: 2500,
      });
    } catch {
      toast({
        key: "copied-answer",
        tone: "warning",
        message: "Couldn't copy. Select the text and press Ctrl+C.",
      });
    }
  };

  return createPortal(
    <motion.div
      initial={false}
      animate={{
        opacity: isActive ? 1 : 0,
        y: isActive ? 0 : 6,
        scale: isActive ? 1 : 0.96,
      }}
      transition={{ duration: 0.18, ease: easeStandard }}
      role="status"
      aria-hidden={!isActive}
      className={cn(
        "fixed z-[var(--z-overlay)] -translate-x-1/2 -translate-y-full",
        sticky ? "pointer-events-auto" : "pointer-events-none",
      )}
      style={{ left: display.position.x, top: display.position.y - 14 }}
    >
      <div className="glass-pop rounded-card relative flex max-w-[22rem] items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className="bg-accent-soft text-accent-ink rounded-control grid h-[30px] w-[30px] shrink-0 place-items-center"
        >
          <SparkleIcon size={17} weight="duotone" />
        </span>
        <div className="min-w-0">
          <b className="text-accent-ink block text-xs font-bold tracking-[0.04em] uppercase">
            AI Agent
          </b>
          <p className="text-ink-soft scroll-thin max-h-[45vh] overflow-y-auto text-[13.5px] leading-snug font-medium break-words whitespace-pre-line">
            {display.message}
          </p>
          {sticky && display.action && (
            <button
              type="button"
              onClick={() => {
                display.action?.run();
                useAgentStore.getState().setAnnotation(null);
              }}
              className="text-accent-ink hover:bg-chip rounded-control mt-1.5 -ml-2 px-2 py-1 text-[12.5px] font-semibold"
            >
              {display.action.label}
            </button>
          )}
        </div>
        {sticky && display.sticky && (
          <div className="-mt-1 -mr-2 flex shrink-0 items-center">
            <button
              type="button"
              aria-label="Copy answer"
              title="Copy answer"
              onClick={() => void copy()}
              className="text-ink-muted hover:text-ink hover:bg-chip rounded-control p-1.5"
            >
              <CopyIcon size={15} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Dismiss answer"
              title="Dismiss (Esc)"
              onClick={() => useAgentStore.getState().setAnnotation(null)}
              className="text-ink-muted hover:text-ink hover:bg-chip rounded-control p-1.5"
            >
              <XIcon size={15} aria-hidden />
            </button>
          </div>
        )}
        {/* Pointer tail: a plain border triangle in the popover fill, so it
            never double-stacks the translucent body like a rotated square
            would. */}
        <span
          aria-hidden
          className="border-t-pop absolute top-full left-1/2 h-0 w-0 -translate-x-1/2 border-x-[8px] border-t-[9px] border-x-transparent"
        />
      </div>
    </motion.div>,
    document.body,
  );
}
