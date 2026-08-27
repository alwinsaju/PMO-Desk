"use client";

import type { Icon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Button } from "@/components/ui";
import { springSnappy } from "@/lib/motion";
import { AppIconTile } from "./AppIconTile";
import type { AppListing } from "./types";

interface AppCardProps {
  app: AppListing;
  icon: Icon;
  isInstalled: boolean;
  onToggleInstall: () => void;
}

/**
 * One row inside an AppCategoryRow list: just the icon, the app's name,
 * and a single Install/Open control — no rating/review chrome, and no
 * click-through to a detail view (there isn't one). A plain `<li>` rather
 * than a wrapping `<button>`, since the Install/Open button is the only
 * interactive element left in the row.
 */
export function AppCard({ app, icon, isInstalled, onToggleInstall }: AppCardProps) {
  return (
    <li className="flex items-center gap-3 p-3">
      <AppIconTile icon={icon} />
      <span className="text-ink min-w-0 flex-1 truncate text-[14px] font-semibold">
        {app.name}
      </span>
      <Button
        type="button"
        size="sm"
        variant={isInstalled ? "secondary" : "solid"}
        onClick={onToggleInstall}
        className="shrink-0 overflow-hidden"
      >
        {/* Keyed by the state itself (not just re-rendered text) so the
         *  label gives a small settled "confirmed" pop on the actual
         *  Install<->Open flip — springSnappy is the same preset the rest
         *  of the kit uses for toggle flips (see src/lib/motion.ts) — while
         *  the button's own `transition-colors` (from Button's base
         *  className) handles the solid<->secondary color swap underneath
         *  it. A plain mount animation, not AnimatePresence/`exit`: the old
         *  label doesn't need to animate out, it's simply gone the instant
         *  the new one mounts, same as before this existed. */}
        <motion.span
          key={isInstalled ? "open" : "install"}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnappy}
          className="inline-block"
        >
          {isInstalled ? "Open" : "Install"}
        </motion.span>
      </Button>
    </li>
  );
}
