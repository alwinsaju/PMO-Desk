"use client";

import type { Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
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
        className="shrink-0"
      >
        {isInstalled ? "Open" : "Install"}
      </Button>
    </li>
  );
}
