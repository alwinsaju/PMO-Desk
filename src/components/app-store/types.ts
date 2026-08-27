/**
 * Plain, framework-agnostic shapes for the mocked App Store catalog. No
 * live component/icon values live in this file on purpose — `icon` below
 * is just a string key. See `appCatalog.ts`, which is the one file in this
 * package that imports live Phosphor icon components (and carries the
 * "use client" directive because of it — mirrors
 * `src/components/taskbar/pinnedApps.ts`; see ARCHITECTURE.md's third
 * gotcha for why that split matters).
 */

export type AppCategoryId = "productivity" | "creativity" | "utilities";

export interface AppCategory {
  id: AppCategoryId;
  label: string;
}

/** Keys into `appCatalog.ts`'s `appIcons` map — same split as
 *  `pinnedApps.ts`'s `PinnedApp["icon"]`. */
export type AppIconName =
  | "Kanban"
  | "Calendar"
  | "Wallet"
  | "ListChecks"
  | "Image"
  | "PaintBrush"
  | "Waveform"
  | "FilmSlate"
  | "LockKey"
  | "WifiHigh"
  | "ClipboardText"
  | "ArrowsClockwise";

export interface AppListing {
  id: string;
  name: string;
  tagline: string;
  description: string;
  developer: string;
  category: AppCategoryId;
  icon: AppIconName;
  /** 0-5. */
  rating: number;
  ratingCount: number;
  /** Pre-formatted, e.g. "24 MB" — this is a mocked catalog, there is no
   *  real binary behind any entry to measure. */
  sizeLabel: string;
  /** Pre-formatted, e.g. "Free" or "$2.99". Purely cosmetic: Install/Open
   *  (see AppCard.tsx / AppDetailView.tsx) only ever flip local component
   *  state and never trigger a real purchase. */
  price: string;
  /** Shown in the "Featured" row atop the browse view. */
  featured?: boolean;
}
