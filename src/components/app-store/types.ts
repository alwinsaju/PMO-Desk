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

/** Keys into `appCatalog.ts`'s `appIcons` map (a string key here, resolved
 *  to a live component there). The last 8 are only used by the
 *  real web apps (see `AppListing.url`) — deliberately generic/functional
 *  glyphs (an envelope, a chat bubble, ...) rather than any real brand's
 *  actual logo; see appCatalog.ts's "Real web apps" section for why. */
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
  | "ArrowsClockwise"
  | "EnvelopeSimple"
  | "FileText"
  | "ChatCircleText"
  | "Notebook"
  | "UsersThree"
  | "Code"
  | "BookOpenText"
  | "PlayCircle";

export interface AppListing {
  id: string;
  name: string;
  /** Not shown on the card (see AppCard.tsx) — kept because it's part of
   *  what the search box matches against, alongside `name`/`developer`. */
  tagline: string;
  developer: string;
  category: AppCategoryId;
  icon: AppIconName;
  /** Shown in the "Featured" row atop the browse view. */
  featured?: boolean;
  /**
   * Present only on the small set of REAL, working web apps in the catalog
   * (see appCatalog.ts's "Real web apps" section) — undefined for every
   * fictional entry above it. When set, the App Store's "Open" action
   * (AppStoreApp.tsx) opens this URL in the generic "web-app" window
   * (src/components/apps/web-app/) instead of just toggling shared install
   * state the way every fictional entry still does.
   */
  url?: string;
  /** Whether `url`'s site allows itself to be framed — a static flag,
   *  hand-verified against the real site's response headers, never
   *  detected at runtime. See `WindowState.embeddable`'s doc comment for
   *  why. Only meaningful alongside `url`. */
  embeddable?: boolean;
}
