// The colour and shape of a register cell: RAG tones for status, impact and likelihood, type chips
// and owner initials. Pure; the table and the card view both read it (see registerView.test.mjs).
import type { RegisterDef } from "./types.ts";

export type CellTone =
  "success" | "warning" | "danger" | "info" | "accent" | "neutral" | "outline";

const LEVEL_KEYS = new Set(["impact", "likelihood", "schedule", "budget", "scope"]);
const LEVEL: Record<string, CellTone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  green: "success",
  amber: "warning",
  red: "danger",
};
const PRIORITY: Record<string, CellTone> = {
  P1: "danger",
  P2: "warning",
  P3: "info",
  P4: "neutral",
};
const RAID_KIND: Record<string, CellTone> = {
  Risk: "warning",
  Assumption: "info",
  Issue: "danger",
  Dependency: "accent",
};
const QUIET_STATUS = new Set([
  "Superseded",
  "Cancelled",
  "Excused",
  "On leave",
  "Inactive",
  "Ended",
]);
const BAD_STATUS = new Set(["Open", "Missing", "Rejected"]);
const PENDING_STATUS = new Set([
  "Mitigating",
  "Proposed",
  "Draft",
  "Submitted",
  "Planned",
  "Renewing",
  "Ready",
]);

function statusTone(def: RegisterDef, status: string): CellTone {
  if (QUIET_STATUS.has(status)) return "neutral";
  if ((def.closed ?? []).includes(status)) return "success";
  if (BAD_STATUS.has(status)) return "danger";
  return PENDING_STATUS.has(status) ? "warning" : "accent";
}

/** The badge tone for a cell, or null when the cell is plain text. */
export function cellTone(def: RegisterDef, key: string, value: string): CellTone | null {
  if (!value) return null;
  if (key === def.statusKey) return statusTone(def, value);
  if (LEVEL_KEYS.has(key)) return LEVEL[value.toLowerCase()] ?? null;
  if (key === "priority") return PRIORITY[value] ?? null;
  if (key === "kind")
    return def.id === "raid" ? (RAID_KIND[value] ?? "outline") : "outline";
  return null;
}

/** Up to two capitals for an avatar: "Priya Nair" -> "PN", "priya.nair@x.com" -> "PN". */
export function personInitials(name: string): string {
  const words = name
    .split("@")[0]
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}
