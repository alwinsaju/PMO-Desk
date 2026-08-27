"use client";

import type { ReactNode } from "react";
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

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-2">
      <span className="text-ink flex items-center gap-1 text-[13px] font-semibold">
        {icon}
        {value}
      </span>
      <span className="text-ink-faint text-[11px]">{label}</span>
    </div>
  );
}

/**
 * Full-window detail screen for one catalog entry, replacing the browse
 * view entirely while open (see AppStoreApp.tsx — it renders either the
 * browse layout or this, never both). Its own back button is the only way
 * out, a conventional store-detail layout per this package's visual brief.
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

          <div className="border-border/60 divide-border/60 grid grid-cols-4 divide-x rounded-2xl border">
            <Stat
              label="Rating"
              value={app.rating.toFixed(1)}
              icon={<StarIcon size={12} weight="fill" />}
            />
            <Stat label="Category" value={categoryLabel} />
            <Stat label="Size" value={app.sizeLabel} />
            <Stat label="Price" value={app.price} />
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-ink text-[13px] font-semibold">About</h2>
            <p className="text-ink-muted text-[13px] leading-relaxed">
              {app.description}
            </p>
            <p className="text-ink-faint text-[11px]">
              {app.ratingCount.toLocaleString()} ratings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
