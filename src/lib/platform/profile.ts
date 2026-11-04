// Profile modes: a lead sees everything; a team member gets a leaner Dashboard and no
// approve/reject buttons for other people's leave. This is a convenience, not a
// security boundary: anyone can switch it in Settings, and nothing is hidden from the
// data folder itself. Pure.
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  sanitizeLayout,
  type Layout,
} from "../dashboard/layout.ts";

export const PROFILE_IDS = ["pmo-lead", "team-member"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface ProfileInfo {
  id: ProfileId;
  label: string;
  hint: string;
  /** May approve or reject other people's leave. */
  decidesLeave: boolean;
}

export const PROFILES: Readonly<Record<ProfileId, ProfileInfo>> = {
  "pmo-lead": {
    id: "pmo-lead",
    label: "PMO lead",
    hint: "The full Dashboard, leave approvals and the team views.",
    decidesLeave: true,
  },
  "team-member": {
    id: "team-member",
    label: "Team member",
    hint: "A lean Dashboard (your to-dos and who is out) and no leave approvals.",
    decidesLeave: false,
  },
};

export function sanitizeProfile(value: unknown): ProfileId {
  return PROFILE_IDS.includes(value as ProfileId) ? (value as ProfileId) : "pmo-lead";
}

const MEMBER_HIDDEN = [
  "reports",
  "staff",
  "workload",
  "aging",
  "signoff",
  "health",
  "week",
  "registers",
  "rag",
  "scorecard",
] as const;

/** The Dashboard cards a profile starts with. */
export function defaultLayoutFor(profile: ProfileId): Layout {
  if (profile === "pmo-lead") return DEFAULT_LAYOUT;
  return {
    order: [...WIDGET_IDS],
    hidden: [...MEMBER_HIDDEN],
    wide: ["today"],
  };
}

const sameLayout = (a: Layout, b: Layout): boolean =>
  JSON.stringify(sanitizeLayout(a)) === JSON.stringify(sanitizeLayout(b));

/** The layout after switching profile: the new profile's own default, unless the person
 *  has customised the Dashboard, which is left exactly as they made it. */
export function layoutAfterSwitch(
  current: Layout,
  from: ProfileId,
  to: ProfileId,
): { layout: Layout; kept: boolean } {
  if (from === to) return { layout: current, kept: true };
  if (sameLayout(current, defaultLayoutFor(from))) {
    return { layout: defaultLayoutFor(to), kept: false };
  }
  return { layout: current, kept: true };
}

export const canDecideLeave = (profile: ProfileId): boolean =>
  PROFILES[profile].decidesLeave;
