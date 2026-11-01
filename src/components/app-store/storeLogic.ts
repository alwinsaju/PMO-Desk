// Browsing the App Store: search, categories with counts and the featured hero. Pure; see storeLogic.test.mjs.
import type { AppCategory, AppCategoryId, AppListing } from "./types.ts";

export type CategoryFilter = "all" | AppCategoryId;

/** Apps whose name, tagline or developer contains the text; nothing for blank text. */
export function matchApps(apps: readonly AppListing[], query: string): AppListing[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return apps.filter((app) =>
    `${app.name} ${app.tagline} ${app.developer}`.toLowerCase().includes(needle),
  );
}

/** "All" and then each category, with how many apps each holds. */
export function categoryCounts(
  apps: readonly AppListing[],
  categories: readonly AppCategory[],
): { id: CategoryFilter; label: string; count: number }[] {
  return [
    { id: "all", label: "All", count: apps.length },
    ...categories.map((cat) => ({
      id: cat.id,
      label: cat.label,
      count: apps.filter((app) => app.category === cat.id).length,
    })),
  ];
}

export const featuredApps = (apps: readonly AppListing[]): AppListing[] =>
  apps.filter((app) => app.featured);

/** Steps through a list of `length` items and loops at either end. */
export function wrapIndex(index: number, length: number): number {
  return length <= 0 ? 0 : ((index % length) + length) % length;
}
