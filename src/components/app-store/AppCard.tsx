"use client";

import { StarIcon, type Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { AppIconTile } from "./AppIconTile";
import type { AppListing } from "./types";

interface AppCardProps {
  app: AppListing;
  icon: Icon;
  isInstalled: boolean;
  onSelect: () => void;
  onToggleInstall: () => void;
}

/**
 * One row inside an AppCategoryRow list: the icon/name/tagline/rating sit
 * behind a click target that opens AppDetailView, and Install/Open is a
 * separate sibling control — two independent interactive elements, never
 * a `<button>` nested inside another `<button>`. Grouping elements inside
 * the row button use `<span>` (not `<div>`) so the DOM stays valid
 * phrasing content.
 */
export function AppCard({
  app,
  icon,
  isInstalled,
  onSelect,
  onToggleInstall,
}: AppCardProps) {
  return (
    <li className="flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={onSelect}
        className="rounded-control focus-visible:ring-accent flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2"
      >
        <AppIconTile icon={icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-ink truncate text-[14px] font-semibold">{app.name}</span>
          <span className="text-ink-muted truncate text-[12px]">{app.tagline}</span>
          <span className="text-ink-faint mt-0.5 flex items-center gap-1 text-[11px]">
            <StarIcon size={11} weight="fill" />
            {app.rating.toFixed(1)}
          </span>
        </span>
      </button>
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
