"use client";

import { useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { appIcons } from "./appCatalog";
import { AppIconTile } from "./AppIconTile";
import { InstallButton } from "./InstallButton";
import { wrapIndex } from "./storeLogic";
import type { AppListing } from "./types";

/** The banner at the top of the store: one featured app at a time, with arrows and dots to move
 *  between them. It does not rotate by itself. */
export function AppHero({
  apps,
  installedIds,
  onPrimaryAction,
  onOpenDetails,
}: {
  apps: AppListing[];
  installedIds: Record<string, true>;
  onPrimaryAction: (app: AppListing) => void;
  onOpenDetails: (app: AppListing) => void;
}) {
  const [index, setIndex] = useState(0);
  if (apps.length === 0) return null;
  const at = wrapIndex(index, apps.length);
  const app = apps[at];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured apps"
      data-testid="store-hero"
      className="rounded-card border-line from-accent-soft to-chip relative flex flex-col gap-4 overflow-hidden border bg-linear-to-br px-6 py-5"
    >
      <p className="text-accent-ink text-[11.5px] font-bold tracking-[0.08em] uppercase">
        Featured
      </p>
      <div
        key={app.id}
        role="group"
        aria-roledescription="slide"
        aria-label={`${at + 1} of ${apps.length}`}
        className="motion-safe:animate-rise flex flex-wrap items-center gap-5"
      >
        <AppIconTile
          icon={appIcons[app.icon]}
          seed={app.id}
          brandSlot={(at % 3) as 0 | 1 | 2}
          className="h-[76px] w-[76px] [&_svg]:h-9 [&_svg]:w-9"
        />
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-ink text-[24px] leading-tight font-bold tracking-[-0.02em]">
            {app.name}
          </h2>
          <p className="text-ink-soft mt-0.5 text-[14px]">{app.tagline}</p>
          <p className="text-ink-muted mt-0.5 text-[12.5px]">{app.developer}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <InstallButton
            app={app}
            isInstalled={Boolean(installedIds[app.id])}
            onPrimaryAction={() => onPrimaryAction(app)}
            className="min-w-[96px]"
          />
          <button
            type="button"
            onClick={() => onOpenDetails(app)}
            className="text-ink-soft focus-ring rounded-chip px-3 py-1.5 text-[13px] font-semibold underline-offset-2 hover:underline"
          >
            Details
          </button>
        </div>
      </div>
      {apps.length > 1 && (
        <div className="flex items-center gap-1.5">
          <IconButton
            aria-label="Previous featured app"
            size="sm"
            onClick={() => setIndex(at - 1)}
          >
            <CaretLeftIcon />
          </IconButton>
          {apps.map((other, i) => (
            <button
              key={other.id}
              type="button"
              aria-label={`Show ${other.name}`}
              aria-current={i === at}
              onClick={() => setIndex(i)}
              className={cn(
                "focus-ring h-2 rounded-full transition-all",
                i === at ? "bg-accent w-5" : "bg-ink-faint w-2",
              )}
            />
          ))}
          <IconButton
            aria-label="Next featured app"
            size="sm"
            onClick={() => setIndex(at + 1)}
          >
            <CaretRightIcon />
          </IconButton>
        </div>
      )}
    </section>
  );
}
