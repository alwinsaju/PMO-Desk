"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { easeStandard } from "@/lib/motion";
import { useAgentStore } from "./agentStore";
import type { AgentAnnotation } from "./types";

/**
 * A small dark-teal speech-bubble callout with a pointer tail, anchored to
 * an arbitrary screen position (the focused window's top edge — see
 * CommandBar's submit handler) rather than any specific app's DOM. Shows
 * the current task's short canned "what the AI is doing" message.
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
      className="pointer-events-none fixed z-[var(--z-overlay)] -translate-x-1/2 -translate-y-full"
      style={{ left: display.position.x, top: display.position.y - 14 }}
    >
      <div className="bg-accent text-accent-contrast shadow-float-lg relative max-w-[16rem] rounded-2xl px-3.5 py-2 text-[13px] font-medium">
        {display.message}
        <span
          aria-hidden
          className="bg-accent absolute top-full left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45"
        />
      </div>
    </motion.div>,
    document.body,
  );
}
