// Settings > Data: how full the data folder feels and how fresh the last backup is. Pure.

/** A comfortable size for the data folder; the meter fills toward it. Past it the folder is simply large. */
export const STORAGE_GUIDE_BYTES = 1024 ** 3;

export type MeterTone = "success" | "warning" | "danger";

export interface StorageMeter {
  /** 0-100 of the guide. */
  percent: number;
  tone: MeterTone;
  note: string;
}

export function storageMeter(bytes: number, guide = STORAGE_GUIDE_BYTES): StorageMeter {
  const used = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const share = guide > 0 ? used / guide : 0;
  const percent = Math.min(100, Math.round(share * 100));
  if (share < 0.5) {
    return { percent, tone: "success", note: "Plenty of room." };
  }
  if (share < 0.9) {
    return {
      percent,
      tone: "warning",
      note: "Getting large. Back up, then tidy up old data.",
    };
  }
  return {
    percent,
    tone: "danger",
    note: "Very large. Back up, then clear what you no longer need.",
  };
}

export type BackupTone = "success" | "warning" | "neutral";

export interface BackupStatus {
  /** "Today", "3 days ago" or "Never". */
  when: string;
  tone: BackupTone;
  note: string;
}

const DAY_MS = 86_400_000;

/** How recent the last backup is. `lastIso` is "" when there has never been one. */
export function backupStatus(lastIso: string, now: Date): BackupStatus {
  const at = Date.parse(lastIso);
  if (!lastIso || Number.isNaN(at)) {
    return {
      when: "Never",
      tone: "warning",
      note: "No backup from this computer yet. Back up now and keep the zip somewhere safe.",
    };
  }
  const days = Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
  const when = days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
  if (days <= 7) return { when, tone: "success", note: "Your data is backed up." };
  if (days <= 30)
    return { when, tone: "neutral", note: "A fresh backup is a good idea soon." };
  return { when, tone: "warning", note: "It has been over a month. Back up again." };
}
