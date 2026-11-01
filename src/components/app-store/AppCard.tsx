"use client";

import type { Icon } from "@phosphor-icons/react";
import { AppIconTile } from "./AppIconTile";
import { InstallButton } from "./InstallButton";
import { isDemoApp } from "./installFlow";
import type { AppListing } from "./types";

interface AppCardProps {
  app: AppListing;
  icon: Icon;
  isInstalled: boolean;
  onToggleInstall: () => void;
  /** Opens the app's detail sheet. */
  onOpenDetails: () => void;
  /** Position in its list, for the staggered entrance. */
  index?: number;
}

/**
 * One card in an AppCategoryRow grid: colored icon tile, the app's name and
 * tagline (together a button that opens the detail sheet) and a single
 * Install/Open control. The card itself only carries the cursor spotlight
 * (`spot`) on hover — no lift or scale. The install flow (Install ->
 * Installing… -> Open) is shared with the detail sheet, see `useAppInstall`.
 */
export function AppCard({
  app,
  icon,
  isInstalled,
  onToggleInstall,
  onOpenDetails,
  index = 0,
}: AppCardProps) {
  const demo = isDemoApp(app);

  return (
    <li
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="spot rounded-card bg-card border-line motion-safe:animate-rise flex items-center gap-3.5 border px-4 py-3.5"
    >
      <button
        type="button"
        onClick={onOpenDetails}
        aria-label={`Details for ${app.name}`}
        className="focus-ring rounded-control flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <AppIconTile icon={icon} seed={app.id} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-ink line-clamp-1 text-[15px] font-bold">
              {app.name}
            </span>
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
      </button>
      <InstallButton
        app={app}
        isInstalled={isInstalled}
        onPrimaryAction={onToggleInstall}
        className="min-w-[84px] shrink-0 overflow-hidden"
      />
    </li>
  );
}
