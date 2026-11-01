"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  Button,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useWindowContext } from "@/components/window-manager";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { appCatalog, appCategories } from "./appCatalog";
import { AppCategoryRow } from "./AppCategoryRow";
import { runAppPrimaryAction } from "./appActions";
import { useInstalledAppsStore } from "./installedAppsStore";
import type { AppCategoryId } from "./types";

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
 * Just the browse view (search + category tabs + grouped cards) — there is
 * no per-app detail screen.
 */
export function AppStoreApp({ windowId }: { windowId: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  useWindowContext(
    windowId,
    category === "all"
      ? null
      : (appCategories.find((c) => c.id === category)?.label ?? null),
  );

  // Shared, persisted install state — see installedAppsStore.ts. Every open
  // App Store window instance (see AppComponent's own doc comment on
  // multiple instances) reads/writes this same store, unlike the old
  // per-instance useState it replaces.
  const installedIds = useInstalledAppsStore((s) => s.installedIds);

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
        <div className="px-gutter flex flex-col items-start gap-3.5 pt-1 pb-2">
          <label
            className={
              "rounded-bar bg-field border-line-strong ease-smooth flex h-12 w-full items-center gap-3 border px-[18px] " +
              "transition-[border-color,box-shadow] duration-200 " +
              "focus-within:border-focus focus-within:shadow-[0_0_0_5px_var(--color-accent-soft)]"
            }
          >
            <MagnifyingGlassIcon size={18} className="text-ink-muted shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              {...noSpellcheck}
              className="text-ink placeholder:text-ink-muted h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
          </label>
          <p className="text-ink-muted text-[12.5px]">
            Sample catalogue: apps marked <strong className="font-semibold">Demo</strong>{" "}
            are examples and do nothing yet; the others open the real website.
          </p>

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
          {/* `@container`: the card grids switch between 1 and 2 columns on
              THIS pane's width (the window can be resized), not the viewport. */}
          <div className="px-gutter @container flex flex-col gap-6 pt-3 pb-6">
            {trimmedQuery ? (
              <>
                <AppCategoryRow
                  title={`Results for "${trimmedQuery}"`}
                  apps={searchResults}
                  installedIds={installedIds}
                  onToggleInstall={runAppPrimaryAction}
                />
                {searchResults.length === 0 && (
                  <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                    <span className="bg-chip text-ink-muted rounded-tile inline-flex h-14 w-14 items-center justify-center">
                      <MagnifyingGlassIcon size={26} />
                    </span>
                    <p className="text-ink text-[15px] font-semibold">
                      No apps found for &quot;{trimmedQuery}&quot;.
                    </p>
                    <p className="text-ink-muted text-[13px]">
                      Try a different name, or browse a category instead.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <TabsContent value="all" className="flex flex-col gap-6 outline-none">
                  <AppCategoryRow
                    title="Featured"
                    apps={featuredApps}
                    installedIds={installedIds}
                    onToggleInstall={runAppPrimaryAction}
                  />
                  {appCategories.map((cat) => (
                    <AppCategoryRow
                      key={cat.id}
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onToggleInstall={runAppPrimaryAction}
                    />
                  ))}
                </TabsContent>
                {appCategories.map((cat) => (
                  <TabsContent key={cat.id} value={cat.id} className="outline-none">
                    <AppCategoryRow
                      title={cat.label}
                      apps={appCatalog.filter((app) => app.category === cat.id)}
                      installedIds={installedIds}
                      onToggleInstall={runAppPrimaryAction}
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
