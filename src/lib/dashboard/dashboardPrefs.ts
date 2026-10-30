// The Dashboard's saved settings: its layout, named layouts and the morning briefing. Pure.
import {
  DEFAULT_LAYOUT,
  sanitizeLayout,
  sanitizeSavedLayouts,
  type Layout,
  type SavedLayout,
} from "./layout.ts";
import { validTimeText } from "./time.ts";

export interface DashboardPrefs {
  layout: Layout;
  layouts: SavedLayout[];
  briefingEnabled: boolean;
  /** "HH:MM" local. */
  briefingTime: string;
  /** The day a briefing was last shown (yyyy-mm-dd, "" = never). */
  briefingDay: string;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  layout: DEFAULT_LAYOUT,
  layouts: [],
  briefingEnabled: true,
  briefingTime: "08:30",
  briefingDay: "",
};

export function sanitizeDashboardPrefs(value: unknown): DashboardPrefs {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    layout: raw.layout === undefined ? DEFAULT_LAYOUT : sanitizeLayout(raw.layout),
    layouts: sanitizeSavedLayouts(raw.layouts),
    briefingEnabled:
      typeof raw.briefingEnabled === "boolean" ? raw.briefingEnabled : true,
    briefingTime:
      typeof raw.briefingTime === "string" && validTimeText(raw.briefingTime)
        ? raw.briefingTime
        : "08:30",
    briefingDay:
      typeof raw.briefingDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.briefingDay)
        ? raw.briefingDay
        : "",
  };
}
