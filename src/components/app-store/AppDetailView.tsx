"use client";

import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadSimpleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui";
import { appCategories, appIcons } from "./appCatalog";
import { AppIconTile } from "./AppIconTile";
import type { AppListing } from "./types";

interface AppDetailViewProps {
  app: AppListing;
  isInstalled: boolean;
  onBack: () => void;
  onToggleInstall: () => void;
}

/** Decorative middot separator for the metadata line below the tagline —
 *  the same plain-text join TaskDetailDialog.tsx uses for its own history
 *  rows (`"Completed · agentName"`), rather than boxing each fact into its
 *  own cell. `aria-hidden` since it's punctuation, not content. */
function Dot() {
  return (
    <span aria-hidden className="text-ink-faint">
      ·
    </span>
  );
}

/**
 * Full-window detail screen for one catalog entry, replacing the browse
 * view entirely while open (see AppStoreApp.tsx — it renders either the
 * browse layout or this, never both). Its own back button is the only way
 * out.
 *
 * Rating/category/size/price used to live in a bordered, column-divided
 * stat grid (four boxes with vertical rules between them) — a very
 * literal lift of the generic app-store-detail template rather than this
 * product's own voice, and not a pattern used anywhere else in the shell.
 * They're one quiet, middot-joined line under the tagline instead, same
 * as the meta line under a card's title elsewhere in the shell (see
 * AppCard.tsx's own rating line, and TaskDetailDialog.tsx's history rows).
 */
export function AppDetailView({
  app,
  isInstalled,
  onBack,
  onToggleInstall,
}: AppDetailViewProps) {
  const categoryLabel =
    appCategories.find((category) => category.id === app.category)?.label ?? app.category;

  return (
    <div className="flex h-full flex-col">
      <div className="border-border/60 flex items-center gap-1 border-b p-2">
        <IconButton aria-label="Back to App Store" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon size={18} />
        </IconButton>
        <span className="text-ink-muted text-[13px] font-medium">App Store</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-start gap-4">
            <AppIconTile icon={appIcons[app.icon]} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-ink text-lg font-semibold">{app.name}</h1>
              <p className="text-ink-muted text-[13px]">{app.developer}</p>
              <p className="text-ink-muted mt-1 text-[13px]">{app.tagline}</p>
              <p className="text-ink-faint mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <StarIcon size={12} weight="fill" />
                  {app.rating.toFixed(1)} ({app.ratingCount.toLocaleString()})
                </span>
                <Dot />
                <span>{categoryLabel}</span>
                <Dot />
                <span>{app.sizeLabel}</span>
                <Dot />
                <span>{app.price}</span>
              </p>
            </div>
            <Button
              variant={isInstalled ? "secondary" : "solid"}
              onClick={onToggleInstall}
              className="shrink-0 gap-1.5"
            >
              {isInstalled ? (
                <>
                  <CheckIcon size={15} weight="bold" />
                  Open
                </>
              ) : (
                <>
                  <DownloadSimpleIcon size={15} weight="bold" />
                  Install
                </>
              )}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-ink text-[13px] font-semibold">About</h2>
            <p className="text-ink-muted text-[13px] leading-relaxed">
              {app.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
