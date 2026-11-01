"use client";

import { appIcons } from "./appCatalog";
import { AppCard } from "./AppCard";
import type { AppListing } from "./types";

interface AppCategoryRowProps {
  title: string;
  apps: AppListing[];
  /** Same shape as `installedAppsStore.ts`'s `installedIds` — passed
   *  straight through from `AppStoreApp` rather than converted to a
   *  `Set`, so this stays a plain lookup with no extra allocation. */
  installedIds: Record<string, true>;
  /** Takes the full listing (not just its id) because the caller needs to
   *  branch on `app.url` — a real catalog entry's primary action opens a
   *  window instead of just toggling install state. See AppStoreApp.tsx's
   *  `handlePrimaryAction`. */
  onToggleInstall: (app: AppListing) => void;
  onOpenDetails: (app: AppListing) => void;
}

/**
 * One labeled section of the browse view: a heading plus a two-column grid
 * of AppCard cards (one column when the window is narrow — a container
 * query on the scroll content in AppStoreApp.tsx, not a viewport one). Used
 * for a real category, the "Featured" row, and search results alike — it
 * doesn't care where `apps` came from, and renders nothing at all when the
 * list is empty (search results with no matches, or a category with none —
 * not expected today, but harmless).
 */
export function AppCategoryRow({
  title,
  apps,
  installedIds,
  onToggleInstall,
  onOpenDetails,
}: AppCategoryRowProps) {
  if (apps.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-ink text-[19px] font-bold tracking-[-0.02em]">{title}</h2>
      <ul className="grid grid-cols-1 gap-3 @min-[620px]:grid-cols-2">
        {apps.map((app, index) => (
          <AppCard
            key={app.id}
            app={app}
            icon={appIcons[app.icon]}
            isInstalled={Boolean(installedIds[app.id])}
            onToggleInstall={() => onToggleInstall(app)}
            onOpenDetails={() => onOpenDetails(app)}
            index={index}
          />
        ))}
      </ul>
    </section>
  );
}
