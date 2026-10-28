// Shared data model of the Staff Management app. Plain types only: the server
// store, the API routes, the client store and the UI all import from here.

export const LOCATIONS = ["Onshore", "Offshore"] as const;
export type StaffLocation = (typeof LOCATIONS)[number];

export const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"] as const;

/** `pending`: added by e-mail, waiting for the M365 profile to fill the
 *  M365-sourced fields. `synced`: filled by the profile sync. `manual`: entered
 *  by hand (or imported) and not expecting a sync. */
export type ProfileSync = "pending" | "synced" | "manual";

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  deloitteEmail: string;
  /** Year the person is set for promotion, e.g. "2027". */
  milestone: string;
  /** yyyy-mm-dd, "" when unknown. */
  rollOffDate: string;
  campus: boolean;
  location: StaffLocation | "";
  /** State, from the M365 office location. */
  homeOffice: string;
  level: string;
  offering: string;
  op: string;
  team: string;
  phone: string;
  skills: string[];
  deloittePersonId: string;
  takedaEmail: string;
  staffitStartDate: string;
  staffitEndDate: string;
  contractEndDate: string;
  networkId: string;
  workdayId: string;
  /** Kept on file but never shown in the lists or the detail pane. */
  gender: string;
  clientManager: string;
  /** Left out of the shift planner (and any shift roster built from this list). */
  excludeFromShiftRoster: boolean;
  /** 0 = no photo; otherwise a cache-busting stamp for /api/staff/photos/<id>. */
  photoVersion: number;
  profileSync: ProfileSync;
  createdAt: string;
  updatedAt: string;
}

/** One day of one roster member. `id` is `<memberId>|<yyyy-mm-dd>`, so assigning a
 *  day again replaces the earlier assignment. `ref` says what the day is:
 *    `<scheduleId>:<shiftId>`  a shift of that team's schedule (Shift-3 means
 *                              different hours in different schedules),
 *    `status:<id>`             a day type every team shares (PTO, holiday, ...),
 *    `custom`                  hours typed in by hand, kept in `text`. */
export interface ShiftAssignment {
  id: string;
  memberId: string;
  date: string;
  ref: string;
  /** The typed hours or wording of a `custom` day. */
  text?: string;
  /** The shift was swapped by hand; `note` usually says why. */
  swap?: boolean;
  note?: string;
}

/** One shift in a team's schedule. `days` is the usual working pattern
 *  (0 = Monday ... 6 = Sunday); empty means no fixed pattern. */
export interface ShiftDef {
  id: string;
  label: string;
  /** HH:MM, IST. */
  start: string;
  end: string;
  days: number[];
}

/** A named set of shifts. Teams that work different hours under the same shift
 *  names (Shift-1 ...) each have their own schedule. */
export interface ShiftSchedule {
  id: string;
  name: string;
  shifts: ShiftDef[];
}

/** A team section of the shift roster, using one schedule. */
export interface RosterGroup {
  id: string;
  name: string;
  scheduleId: string;
}

/** A person on the shift roster. Linked to a directory profile when
 *  `employeeId` is set; until then the name and city come from the roster itself. */
export interface RosterMember {
  id: string;
  name: string;
  employeeId: string | null;
  groupId: string;
  city: string;
  /** The sub-team / role text (L2 DIS USI, Complaints, ...). */
  role: string;
}

/** Something that applies to a day (or a run of days) for everyone: a holiday,
 *  a shift-swap day, a note such as the winter disconnect. */
export interface RosterEvent {
  id: string;
  date: string;
  /** Inclusive; same as `date` for a single day. */
  endDate: string;
  label: string;
  kind: "holiday" | "swap" | "note";
}

/** Everything about the shift roster except the day-by-day assignments. */
export interface RosterConfig {
  schedules: ShiftSchedule[];
  groups: RosterGroup[];
  members: RosterMember[];
  events: RosterEvent[];
}

export const TIME_OFF_TYPES = [
  "pto",
  "sick",
  "public-holiday",
  "comp-off",
  "parental",
  "other",
] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number];

export const TIME_OFF_STATUSES = ["pending", "approved", "rejected"] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  type: TimeOffType;
  /** Inclusive, yyyy-mm-dd. */
  startDate: string;
  endDate: string;
  reason: string;
  status: TimeOffStatus;
  createdAt: string;
  decidedAt: string;
}

/** Someone moved off the roster. Kept on file (outside the roster other apps
 *  read) until they are restored or deleted for good. */
export interface OffboardedEmployee extends Employee {
  /** ISO timestamp of when they were moved off the roster. */
  offboardedAt: string;
}

export type StaffKind = "employees" | "shifts" | "timeoff" | "offboarded";

/** A batch of changes to one collection: items are matched by `id`. */
export interface StaffChanges<T> {
  upsert?: T[];
  remove?: string[];
}

/** What the M365 profile flow (Power Automate) sends for one person. */
export interface ProfilePayload {
  email: string;
  firstName?: string;
  lastName?: string;
  homeOffice?: string;
  level?: string;
  /** Offering portfolio: the M365 department. */
  op?: string;
  phone?: string;
  /** Raw image bytes, base64 (JPEG / PNG / WebP). */
  photoBase64?: string;
}
