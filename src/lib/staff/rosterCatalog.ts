// The starting point of the shift roster: the schedules, team sections and day
// types of the team's roster workbook (Shiftroster_Takeda). Everything here can
// be changed in the app (Shift roster > Schedules); this is only what an empty
// roster starts from and what the workbook importer maps names onto.
import type { RosterConfig, RosterGroup, ShiftDef, ShiftSchedule } from "./types.ts";

export type Tone = "accent" | "info" | "amber" | "red" | "success" | "neutral" | "night";

/** Day types every team shares (they are not part of any schedule). */
export interface StatusDef {
  id: string;
  label: string;
  /** What shows in a compact cell. */
  short: string;
  description: string;
  tone: Tone;
}

export const STATUS_PREFIX = "status";

export const STATUS_DEFS: readonly StatusDef[] = [
  {
    id: "holiday",
    label: "Holiday",
    short: "HOL",
    description: "India, US or Mexico holiday (the same code for every location)",
    tone: "amber",
  },
  {
    id: "pto",
    label: "PTO",
    short: "PTO",
    description: "Paid time off",
    tone: "info",
  },
  {
    id: "temp-pto",
    label: "Temp PTO",
    short: "T",
    description: "Temporary PTO",
    tone: "neutral",
  },
  {
    id: "comp",
    label: "Comp off",
    short: "COMP",
    description: "Compensatory off",
    tone: "success",
  },
  {
    id: "on-call",
    label: "On-call",
    short: "OC",
    description: "On-call / holiday support",
    tone: "red",
  },
  {
    id: "sick",
    label: "Sick leave",
    short: "SL",
    description: "Sick leave",
    tone: "red",
  },
  {
    id: "off",
    label: "Day off",
    short: "OFF",
    description: "Weekly off marked on purpose (for example after a swap)",
    tone: "neutral",
  },
];

export const statusRef = (id: string): string => `${STATUS_PREFIX}:${id}`;
export const CUSTOM_REF = "custom";

const MON_FRI = [0, 1, 2, 3, 4];
const WED_SUN = [2, 3, 4, 5, 6];

const shift = (
  id: string,
  label: string,
  start: string,
  end: string,
  days: number[] = [],
): ShiftDef => ({ id, label, start, end, days });

const MAIN_SHIFTS: ShiftDef[] = [
  shift("shift-1", "Shift-1", "08:00", "17:00", MON_FRI),
  shift("shift-2", "Shift-2", "08:00", "17:00", WED_SUN),
  shift("shift-3", "Shift-3", "14:00", "23:00", MON_FRI),
  shift("shift-4", "Shift-4", "14:00", "23:00", WED_SUN),
  shift("shift-5", "Shift-5", "11:30", "20:30", MON_FRI),
  shift("us-cst", "US-CST", "21:00", "06:00"),
  shift("us-pst", "US-PST", "23:00", "08:00"),
  shift("ns", "NS", "19:00", "04:00"),
];

export function defaultSchedules(): ShiftSchedule[] {
  return [
    {
      id: "main",
      name: "Main",
      shifts: MAIN_SHIFTS.map((s) => ({ ...s, days: [...s.days] })),
    },
    {
      id: "device-support",
      name: "Device Support",
      shifts: [
        shift("shift-1", "Shift-1", "16:30", "01:30", MON_FRI),
        shift("shift-3", "Shift-3", "21:00", "06:00"),
        shift("shift-4", "Shift-4", "19:30", "04:30", MON_FRI),
      ],
    },
    {
      id: "lab",
      name: "Lab",
      shifts: [
        shift("shift-1", "Shift-1", "14:00", "23:00", MON_FRI),
        shift("shift-2", "Shift-2", "16:00", "01:00", MON_FRI),
        shift("shift-3", "Shift-3", "18:30", "03:30", MON_FRI),
        shift("weekend", "Weekend (W)", "18:30", "03:30", [5, 6]),
      ],
    },
    {
      id: "lns-2",
      name: "LNS 2.0",
      shifts: [
        shift("shift-1", "Shift-1", "16:30", "01:30", MON_FRI),
        shift("shift-2", "Shift-2", "12:00", "21:00", MON_FRI),
      ],
    },
    {
      // The workbook has no legend of its own for this team yet; it starts from the main shifts.
      id: "integration-hub",
      name: "Integration Hub",
      shifts: MAIN_SHIFTS.map((s) => ({ ...s, days: [...s.days] })),
    },
  ];
}

/** Team sections of the workbook and the schedule each one uses. */
export function defaultGroups(): RosterGroup[] {
  return [
    { id: "l2", name: "L2", scheduleId: "main" },
    { id: "dep", name: "DEP", scheduleId: "main" },
    { id: "l3", name: "L3", scheduleId: "main" },
    { id: "device-support", name: "Device Support", scheduleId: "device-support" },
    { id: "lab", name: "Lab", scheduleId: "lab" },
    { id: "cms-2", name: "CMS 2.0", scheduleId: "main" },
    { id: "eks", name: "EKS", scheduleId: "main" },
    { id: "lns-2", name: "LNS 2.0", scheduleId: "lns-2" },
    { id: "integration-hub", name: "Integration Hub", scheduleId: "integration-hub" },
  ];
}

export function defaultRosterConfig(): RosterConfig {
  return {
    schedules: defaultSchedules(),
    groups: defaultGroups(),
    members: [],
    events: [],
  };
}

/** Section names as the workbook writes them -> the group they belong to. */
export const GROUP_ALIASES: Readonly<Record<string, string>> = {
  "device support l3": "device-support",
  "l n s 2.0": "lns-2",
  "lns 2.0": "lns-2",
  "cms 2.0": "cms-2",
  governance: "integration-hub",
};

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
