"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { CursorIcon } from "@phosphor-icons/react";
import { springTrailing } from "@/lib/motion";
import { useAgentStore } from "./agentStore";

/**
 * The AI's on-screen cursor: a soft, filled accent-teal pointer with a
 * subtle glow and a small "AI Agent" name-tag chip, like a multiplayer
 * cursor in Docs/Figma. Portal-rendered straight to `document.body` so its
 * `position: fixed` coordinates are always relative to the viewport,
 * regardless of where this component happens to be mounted in the tree
 * (or what stacking/overflow context its React parent has).
 *
 * Purely reactive: it owns no timers or sequencing of its own. CommandBar
 * (the one place the mocked demo sequence begins) is what sets
 * `cursorTarget`/`commandBarAnchor` in agentStore; this component's only
 * job is to glide between whatever those values currently are using the
 * loose, heavy `springTrailing` preset, so the motion itself reads as "an
 * agent chasing a point" rather than a teleport.
 *
 * Deliberately always mounted (never conditionally removed via
 * AnimatePresence/`exit`) once past the SSR-safety gate below — it just
 * animates its own opacity to 0 and glides back to the command bar's
 * anchor when idle. This mirrors Window.tsx's own approach (animate
 * between visual states on one persistent motion node, rather than
 * mounting/unmounting) instead of relying on AnimatePresence's exit-
 * completion detection, which turned out not to reliably fire here when
 * mixed with a per-variant `exit.transition` override — the store's
 * `cursorTarget` correctly went back to null (verified independently),
 * but the mount/unmount-based version never actually removed the node.
 */
export function AICursor() {
  // Gate on mount before touching `document`/`window` — this component is
  // reached (transitively) from Desktop.tsx, a Server Component, so its
  // first render pass must not assume a browser environment.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const target = useAgentStore((s) => s.cursorTarget);
  const anchor = useAgentStore((s) => s.commandBarAnchor);

  if (!mounted) return null;

  // Fallback only matters before CommandBar's first measurement effect has
  // run, which in practice completes long before a user can type + submit.
  const home = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight - 48 };
  const isActive = target !== null;
  const point = target ?? home;

  return createPortal(
    <motion.div
      initial={false}
      animate={{
        x: point.x,
        y: point.y,
        opacity: isActive ? 1 : 0,
        scale: isActive ? 1 : 0.85,
      }}
      transition={{
        x: springTrailing,
        y: springTrailing,
        opacity: { duration: 0.22 },
        scale: { duration: 0.22 },
      }}
      className="pointer-events-none fixed top-0 left-0 z-[var(--z-overlay)]"
    >
      <CursorIcon
        size={30}
        weight="fill"
        className="text-accent -translate-x-1 -translate-y-1"
        style={{ filter: "drop-shadow(0 0 10px rgba(36, 92, 80, 0.6))" }}
      />
      <span className="bg-accent text-accent-contrast shadow-float-sm absolute top-6 left-5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
        AI Agent
      </span>
    </motion.div>,
    document.body,
  );
}
