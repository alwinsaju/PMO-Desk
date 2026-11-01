// Saved platform settings: profile, what's-new, the guided tour, sample data and the
// opt-in update check. Pure. Kept on this computer like every other setting.
import { sanitizeProfile, type ProfileId } from "./profile.ts";

export interface UpdatePrefs {
  /** Off until the person turns it on. */
  enabled: boolean;
  /** Where the "latest release" file is served (https). Empty = nothing to check. */
  manifestUrl: string;
  lastCheckedAt: string;
  /** The newest version the last check found (empty = none or up to date). */
  availableVersion: string;
}

export interface PlatformPrefs {
  profile: ProfileId;
  /** The version whose "what's new" the person has seen ("" = never). */
  lastSeenVersion: string;
  tourDone: boolean;
  /** Sample data was added and not yet removed. */
  sampleLoaded: boolean;
  updates: UpdatePrefs;
  /** When a backup was last created from Settings > Data (ISO; "" = never). */
  lastBackupAt: string;
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = {
  enabled: false,
  manifestUrl: "",
  lastCheckedAt: "",
  availableVersion: "",
};

export const DEFAULT_PLATFORM_PREFS: PlatformPrefs = {
  profile: "pmo-lead",
  lastSeenVersion: "",
  tourDone: false,
  sampleLoaded: false,
  updates: DEFAULT_UPDATE_PREFS,
  lastBackupAt: "",
};

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export function sanitizeUpdatePrefs(value: unknown): UpdatePrefs {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    manifestUrl: str(raw.manifestUrl, 500),
    lastCheckedAt: str(raw.lastCheckedAt, 40),
    availableVersion: str(raw.availableVersion, 32),
  };
}

export function sanitizePlatformPrefs(value: unknown): PlatformPrefs {
  const raw =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    profile: sanitizeProfile(raw.profile),
    lastSeenVersion: str(raw.lastSeenVersion, 32),
    tourDone: raw.tourDone === true,
    sampleLoaded: raw.sampleLoaded === true,
    updates: sanitizeUpdatePrefs(raw.updates),
    lastBackupAt: Number.isNaN(Date.parse(str(raw.lastBackupAt, 40)))
      ? ""
      : str(raw.lastBackupAt, 40),
  };
}
