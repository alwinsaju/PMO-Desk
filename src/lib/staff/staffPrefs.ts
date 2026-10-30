/** The Staff app's saved settings: coverage minimums, the leave allowance, swap requests and checklists. Pure. */
import { sanitizeChecklists, type Checklist } from "./checklists.ts";
import type { CoverageRules } from "./capacity.ts";
import type { SwapRequest } from "./leave.ts";

export interface StaffPrefs {
  /** Minimum people working per team and day, by roster group id. */
  coverage: Record<string, number>;
  /** Paid leave days a year, per person. */
  ptoAllowance: number;
  swaps: SwapRequest[];
  checklists: Checklist[];
  /** Directory ids already seen, so only new arrivals start an onboarding checklist. */
  seenEmployees: string[];
  /** Roster colours that stay apart for colour-blind readers, with a pattern on each shift. */
  colourBlindSafe: boolean;
}

export const DEFAULT_STAFF_PREFS: StaffPrefs = {
  coverage: {},
  ptoAllowance: 20,
  swaps: [],
  checklists: [],
  seenEmployees: [],
  colourBlindSafe: false,
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function sanitizeSwaps(value: unknown): SwapRequest[] {
  if (!Array.isArray(value)) return [];
  const out: SwapRequest[] = [];
  for (const raw of value.slice(0, 200)) {
    if (!isObject(raw)) continue;
    const s = raw as Record<string, unknown>;
    if (
      typeof s.id !== "string" ||
      typeof s.memberA !== "string" ||
      typeof s.memberB !== "string" ||
      typeof s.dateA !== "string" ||
      typeof s.dateB !== "string"
    )
      continue;
    out.push({
      id: s.id.slice(0, 40),
      memberA: s.memberA.slice(0, 40),
      memberB: s.memberB.slice(0, 40),
      dateA: s.dateA.slice(0, 10),
      dateB: s.dateB.slice(0, 10),
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : "",
      status: s.status === "approved" || s.status === "rejected" ? s.status : "pending",
      createdAt: typeof s.createdAt === "string" ? s.createdAt : "",
    });
  }
  return out;
}

export function sanitizeStaffPrefs(value: unknown): StaffPrefs {
  const raw = isObject(value) ? value : {};
  const coverage: Record<string, number> = {};
  if (isObject(raw.coverage)) {
    for (const [k, v] of Object.entries(raw.coverage)) {
      if (Object.keys(coverage).length >= 60) break;
      if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 200)
        coverage[k.slice(0, 60)] = v;
    }
  }
  const allowance = raw.ptoAllowance;
  return {
    coverage,
    ptoAllowance:
      typeof allowance === "number" && allowance >= 0 && allowance <= 366
        ? allowance
        : DEFAULT_STAFF_PREFS.ptoAllowance,
    swaps: sanitizeSwaps(raw.swaps),
    checklists: sanitizeChecklists(raw.checklists),
    seenEmployees: Array.isArray(raw.seenEmployees)
      ? raw.seenEmployees
          .filter((x): x is string => typeof x === "string")
          .slice(0, 5000)
          .map((x) => x.slice(0, 40))
      : [],
    colourBlindSafe: raw.colourBlindSafe === true,
  };
}

export const rulesOf = (p: Pick<StaffPrefs, "coverage">): CoverageRules => p.coverage;
