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
}

/**
 * One labeled section of the browse view: a heading plus a bordered,
 * divided list of AppCard rows (mirrors ai-layer/TaskList.tsx's own
 * heading + divided-list shape). Used for a real category, the "Featured"
 * row, and search results alike — it doesn't care where `apps` came from,
 * and renders nothing at all when the list is empty (search results with
 * no matches, or a category with none — not expected today, but harmless).
 */
export function AppCategoryRow({
  title,
  apps,
  installedIds,
  onToggleInstall,
}: AppCategoryRowProps) {
  if (apps.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-ink text-[13px] font-semibold">{title}</h2>
      <ul className="divide-border/60 border-border/60 bg-surface-elevated divide-y overflow-hidden rounded-2xl border">
        {apps.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            icon={appIcons[app.icon]}
            isInstalled={Boolean(installedIds[app.id])}
            onToggleInstall={() => onToggleInstall(app)}
          />
        ))}
      </ul>
    </section>
  );
}
