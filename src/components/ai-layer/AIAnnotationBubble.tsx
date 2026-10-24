"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { SparkleIcon } from "@phosphor-icons/react";
import { easeStandard } from "@/lib/motion";
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
  if (!mounted || !display) return null;

  const isActive = annotation !== null;

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
      className="pointer-events-none fixed z-[var(--z-overlay)] -translate-x-1/2 -translate-y-full"
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
          <p className="text-ink-soft text-[13.5px] leading-snug font-medium break-words">
            {display.message}
          </p>
        </div>
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
