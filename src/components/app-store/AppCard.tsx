"use client";

import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Button } from "@/components/ui";
import { springSnappy } from "@/lib/motion";
import { SpinnerRing } from "@/components/apps/web-app/EmbedStates";
import { AppIconTile } from "./AppIconTile";
import { INSTALLING_MS, isDemoApp } from "./installFlow";
import type { AppListing } from "./types";

const INSTALLING_LABEL = "Installing…";

interface AppCardProps {
  app: AppListing;
  icon: Icon;
  isInstalled: boolean;
  onToggleInstall: () => void;
  /** Position in its list, for the staggered entrance. */
  index?: number;
}

/**
 * One card in an AppCategoryRow grid: colored icon tile, the app's name and
 * tagline, and a single Install/Open control — no rating/review chrome, and
 * no click-through to a detail view (there isn't one). A plain `<li>` rather
 * than a wrapping `<button>`, since the Install/Open button is the only
 * interactive element in the card. The card itself only carries the cursor
 * spotlight (`spot`) on hover — no lift or scale.
 */
export function AppCard({
  app,
  icon,
  isInstalled,
  onToggleInstall,
  index = 0,
}: AppCardProps) {
  const [installing, setInstalling] = useState(false);

  function handleClick() {
    if (installing) return;
    if (isInstalled) {
      onToggleInstall();
      return;
    }
    setInstalling(true);
    // Not cancelled on unmount: leaving the tab mid-install still completes it.
    window.setTimeout(() => {
      onToggleInstall();
      setInstalling(false);
    }, INSTALLING_MS);
  }

  const label = installing ? INSTALLING_LABEL : isInstalled ? "Open" : "Install";
  const demo = isDemoApp(app);

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="spot rounded-card bg-card border-line motion-safe:animate-rise flex items-center gap-3.5 border px-4 py-3.5"
    >
      <AppIconTile icon={icon} seed={app.id} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-ink line-clamp-1 text-[15px] font-bold">{app.name}</span>
          {demo && (
            <span
              title="A sample app: it does not do anything yet"
              className="bg-chip text-ink-muted rounded-chip shrink-0 px-1.5 text-[10.5px] font-bold uppercase"
            >
              Demo
            </span>
          )}
        </span>
        <span className="text-ink-muted line-clamp-1 text-[12.5px]">{app.tagline}</span>
      </span>
      <Button
        type="button"
        variant={isInstalled && !installing ? "line" : "primary"}
        aria-busy={installing}
        aria-label={installing ? `Installing ${app.name}` : undefined}
        onClick={handleClick}
        className="min-w-[84px] shrink-0 overflow-hidden"
      >
        {/* Keyed by the label (not just re-rendered text) so it gives a small
         *  settled "confirmed" pop on each Install -> Installing -> Open
         *  flip — springSnappy is the same preset the rest of the kit uses
         *  for toggle flips (see src/lib/motion.ts). A plain mount
         *  animation, not AnimatePresence/`exit`: the old label doesn't need
         *  to animate out, it's simply gone the instant the new one mounts. */}
        <motion.span
          key={label}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSnappy}
          className="inline-flex items-center gap-2"
        >
          {installing && <SpinnerRing className="text-inherit" />}
          {label}
        </motion.span>
      </Button>
    </li>
  );
}
