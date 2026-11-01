"use client";

import { motion } from "motion/react";
import { Button, type ButtonProps } from "@/components/ui";
import { SpinnerRing } from "@/components/apps/web-app/EmbedStates";
import { springSnappy } from "@/lib/motion";
import { useAppInstall } from "./useAppInstall";
import type { AppListing } from "./types";

/** The Install / Installing… / Open button of an app, with the small "settled" pop on each change. */
export function InstallButton({
  app,
  isInstalled,
  onPrimaryAction,
  className,
  size,
}: {
  app: AppListing;
  isInstalled: boolean;
  onPrimaryAction: () => void;
  className?: string;
  size?: ButtonProps["size"];
}) {
  const { installing, label, start } = useAppInstall(app, isInstalled, onPrimaryAction);
  return (
    <Button
      type="button"
      variant={isInstalled && !installing ? "line" : "primary"}
      size={size}
      aria-busy={installing}
      aria-label={installing ? `Installing ${app.name}` : undefined}
      onClick={start}
      className={className}
    >
      {/* Keyed by the label so it gives a small settled pop on each Install -> Installing -> Open flip
       *  (springSnappy, the kit's toggle preset). A plain mount animation: the old label is simply gone. */}
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
  );
}
