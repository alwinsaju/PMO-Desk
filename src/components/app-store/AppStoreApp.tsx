"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { appCatalog, appCategories } from "./appCatalog";
import { AppCategoryRow } from "./AppCategoryRow";
import { AppDetailView } from "./AppDetailView";
import type { AppCategoryId } from "./types";

type CategoryFilter = "all" | AppCategoryId;

/**
 * Root App Store window — matches the `AppComponent` contract
 * (`ComponentType<{ windowId: string }>`, see
 * src/components/apps/types.ts) and is registered under "app-store" in
 * `index.ts`. `windowId` isn't needed for any lookup here (every bit of
 * state below is plain per-instance React state — see the note on
 * `installedIds`) but is stamped onto the root as a data attribute so it's
 * still visibly "used" per the contract, e.g. for debugging multiple open
 * App Store windows at once.
 *
 * Renders one of two mutually exclusive screens: the browse view (search
 * + category tabs + grouped rows) or, once a card is clicked,
 * AppDetailView full-screen. Never both at once, mirroring a conventional
 * store app's own navigation.
 */
export function AppStoreApp({ windowId }: { windowId: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  // Local, mocked install state — "Install"/"Open" only ever flip this set,
  // never a real install. Deliberately per-instance (not a shared store):
  // the same appId can be opened into multiple windows at once (see
  // AppComponent's own doc comment), and this is a mocked catalog with no
  // backend to reconcile against, so there's nothing to keep in sync across
  // instances.
  const [installedIds, setInstalledIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  function toggleInstalled(id: string) {
    setInstalledIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedApp = selectedAppId
    ? (appCatalog.find((app) => app.id === selectedAppId) ?? null)
    : null;

  if (selectedApp) {
    return (
      <div data-window-id={windowId} className="h-full w-full">
        <AppDetailView
          app={selectedApp}
          isInstalled={installedIds.has(selectedApp.id)}
          onBack={() => setSelectedAppId(null)}
          onToggleInstall={() => toggleInstalled(selectedApp.id)}
        />
      </div>
    );
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
                  onSelect={setSelectedAppId}
                  onToggleInstall={toggleInstalled}
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
                    onSelect={setSelectedAppId}
                    onToggleInstall={toggleInstalled}
                  />
                  {appCategories.map((cat) => (
                    <AppCategoryRow
                      key={cat.id}
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onSelect={setSelectedAppId}
                      onToggleInstall={toggleInstalled}
                    />
                  ))}
                </TabsContent>
                {appCategories.map((cat) => (
                  <TabsContent key={cat.id} value={cat.id} className="outline-none">
                    <AppCategoryRow
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onSelect={setSelectedAppId}
                      onToggleInstall={toggleInstalled}
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
