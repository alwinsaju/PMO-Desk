"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useWindowStore } from "@/components/window-manager";
import { appCatalog, appCategories, appIcons } from "./appCatalog";
import { AppCategoryRow } from "./AppCategoryRow";
import { useInstalledAppsStore } from "./installedAppsStore";
import type { AppCategoryId, AppListing } from "./types";

type CategoryFilter = "all" | AppCategoryId;

/**
 * Root App Store window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`, see
 * src/components/apps/types.ts) and is registered under "app-store" in
 * `index.ts`. `windowId` isn't needed for any lookup here (search/category
 * are plain per-instance React state, and install state comes from the
 * shared `installedAppsStore`) but is stamped onto the root as a data
 * attribute so it's still visibly "used" per the contract, e.g. for
 * debugging multiple open App Store windows at once.
 *
 * Just the browse view (search + category tabs + grouped rows) — there is
 * no per-app detail screen.
 */
export function AppStoreApp({ windowId }: { windowId: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");

  // Shared, persisted install state — see installedAppsStore.ts. Every open
  // App Store window instance (see AppComponent's own doc comment on
  // multiple instances) reads/writes this same store, unlike the old
  // per-instance useState it replaces.
  const installedIds = useInstalledAppsStore((s) => s.installedIds);
  const installApp = useInstalledAppsStore((s) => s.installApp);
  const uninstallApp = useInstalledAppsStore((s) => s.uninstallApp);

  const openWindow = useWindowStore((s) => s.openWindow);

  function toggleInstalled(id: string) {
    if (installedIds[id]) uninstallApp(id);
    else installApp(id);
  }

  /**
   * The Install/Open button's single click handler, for every card. For a
   * fictional entry (no `url`) this is exactly the pre-existing behavior:
   * flip shared install state, nothing else, since there's no real window
   * content behind it either way.
   *
   * A REAL entry (has `url`) installs the same way on its first click, but
   * once installed, clicking "Open" opens the real window instead of
   * uninstalling it — real apps don't disappear from the Home screen the
   * way toggling this mocked catalog's fictional entries does.
   */
  function handlePrimaryAction(app: AppListing) {
    if (installedIds[app.id] && app.url) {
      const IconGlyph = appIcons[app.icon];
      openWindow("web-app", {
        title: app.name,
        icon: <IconGlyph />,
        url: app.url,
        embeddable: app.embeddable,
      });
      return;
    }
    toggleInstalled(app.id);
  }

  const trimmedQuery = query.trim();
  const searchResults = trimmedQuery
    ? appCatalog.filter((app) => {
        const haystack = `${app.name} ${app.tagline} ${app.developer}`.toLowerCase();
        return haystack.includes(trimmedQuery.toLowerCase());
      })
    : [];
  const featuredApps = appCatalog.filter((app) => app.featured);

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <Tabs
        value={category}
        onValueChange={(value) => setCategory(value as CategoryFilter)}
        className="flex h-full flex-col"
      >
        <div className="border-border/60 flex flex-col gap-3 border-b p-4">
          <div className="border-border bg-surface-elevated focus-within:border-accent focus-within:ring-accent/30 ease-standard rounded-control flex items-center gap-2 border px-3.5 transition-[border-color,box-shadow] duration-150 focus-within:ring-2">
            <MagnifyingGlassIcon size={16} className="text-ink-faint shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              className="text-ink placeholder:text-ink-faint h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          {!trimmedQuery && (
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {appCategories.map((cat) => (
                <TabsTrigger key={cat.id} value={cat.id}>
                  {cat.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-4">
            {trimmedQuery ? (
              <>
                <AppCategoryRow
                  title={`Results for "${trimmedQuery}"`}
                  apps={searchResults}
                  installedIds={installedIds}
                  onToggleInstall={handlePrimaryAction}
                />
                {searchResults.length === 0 && (
                  <p className="text-ink-faint px-1 text-[13px]">
                    No apps found for &quot;{trimmedQuery}&quot;.
                  </p>
                )}
              </>
            ) : (
              <>
                <TabsContent value="all" className="flex flex-col gap-6 outline-none">
                  <AppCategoryRow
                    title="Featured"
                    apps={featuredApps}
                    installedIds={installedIds}
                    onToggleInstall={handlePrimaryAction}
                  />
                  {appCategories.map((cat) => (
                    <AppCategoryRow
                      key={cat.id}
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onToggleInstall={handlePrimaryAction}
                    />
                  ))}
                </TabsContent>
                {appCategories.map((cat) => (
                  <TabsContent key={cat.id} value={cat.id} className="outline-none">
                    <AppCategoryRow
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onToggleInstall={handlePrimaryAction}
                    />
                  </TabsContent>
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
