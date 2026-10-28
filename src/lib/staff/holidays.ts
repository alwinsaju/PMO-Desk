// Holidays by location: which of the team's locations observe a holiday, and
// which holiday applies to a person. Pure; no React, no I/O.
import type { Employee, RosterEvent, RosterMember } from "./types.ts";

/** The locations the team's roster already uses. More are added by typing them. */
export const DEFAULT_LOCATIONS: readonly string[] = [
  "Bengaluru",
  "Chennai",
  "Gurgaon",
  "Hyderabad",
  "Kolkata",
  "Mumbai",
  "Pune",
  "Mexico",
  "US",
];

/** The India offices: the "India" shortcut of the holiday editor. */
export const INDIA_LOCATIONS: readonly string[] = [
  "Bengaluru",
  "Chennai",
  "Gurgaon",
  "Hyderabad",
  "Kolkata",
  "Mumbai",
  "Pune",
];

const ALIASES: Readonly<Record<string, string>> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  gurugram: "Gurgaon",
  "new delhi": "Gurgaon",
  bombay: "Mumbai",
  calcutta: "Kolkata",
  madras: "Chennai",
  "mexico city": "Mexico",
  usa: "US",
  "united states": "US",
};

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  Bengaluru: "BLR",
  Chennai: "CHE",
  Gurgaon: "GUR",
  Hyderabad: "HYD",
  Kolkata: "KOL",
  Mumbai: "MUM",
  Pune: "PUN",
  Mexico: "MEX",
  US: "US",
};

const key = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

/** "Bangalore" -> "Bengaluru", " hyderabad " -> "Hyderabad"; unknown places are kept as typed. */
export function canonicalLocation(text: string): string {
  const k = key(text);
  if (!k) return "";
  if (ALIASES[k]) return ALIASES[k];
  const known = DEFAULT_LOCATIONS.find((l) => key(l) === k);
  return known ?? text.trim().replace(/\s+/g, " ");
}

/** BLR, HYD, ... or the first three letters of a place that has no short form. */
export function abbreviate(location: string): string {
  const name = canonicalLocation(location);
  return ABBREVIATIONS[name] ?? name.slice(0, 3).toUpperCase();
}

/** Where a person works: the roster's own city, else the directory's office. */
export function locationOf(
  member: Pick<RosterMember, "city"> | null,
  employee: Pick<Employee, "homeOffice"> | null,
): string {
  return canonicalLocation(member?.city || employee?.homeOffice || "");
}

/** Does this holiday apply at `location`? No locations listed = everywhere. */
export function observes(event: RosterEvent, location: string): boolean {
  const wanted = event.locations ?? [];
  if (wanted.length === 0) return true;
  const here = canonicalLocation(location);
  return here !== "" && wanted.some((l) => canonicalLocation(l) === here);
}

/** The first holiday among `events` that applies at `location`. */
export function holidayAt(
  events: readonly RosterEvent[] | undefined,
  location: string,
): RosterEvent | undefined {
  return events?.find((e) => e.kind === "holiday" && observes(e, location));
}

/** Every location offered when choosing where a holiday applies. */
export function locationChoices(
  members: readonly RosterMember[],
  employees: readonly Employee[],
  events: readonly RosterEvent[],
): string[] {
  const found = new Map<string, string>();
  const add = (text: string | undefined) => {
    const name = canonicalLocation(text ?? "");
    if (name && !found.has(key(name))) found.set(key(name), name);
  };
  DEFAULT_LOCATIONS.forEach(add);
  members.forEach((m) => add(m.city));
  employees.forEach((e) => add(e.homeOffice));
  events.forEach((e) => e.locations?.forEach(add));
  const rank = (name: string) => {
    const i = DEFAULT_LOCATIONS.indexOf(name);
    return i === -1 ? DEFAULT_LOCATIONS.length : i;
  };
  return [...found.values()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** A short phrase for where a holiday applies: "Every location", "All India",
 *  "All except GUR, KOL" or "HYD, PUN". */
export function describeLocations(
  locations: readonly string[] | undefined,
  choices: readonly string[],
): string {
  const chosen = new Set((locations ?? []).map(canonicalLocation));
  if (chosen.size === 0) return "Every location";
  const all = choices.map(canonicalLocation);
  const missing = all.filter((l) => !chosen.has(l));
  if (all.length > 2 && missing.length === 0) return "Every location";
  const india = INDIA_LOCATIONS.filter((l) => all.includes(l));
  if (
    india.length > 1 &&
    india.length === chosen.size &&
    india.every((l) => chosen.has(l))
  ) {
    return "All India";
  }
  // Every India location but one or two, and nothing outside India.
  const indiaMissing = india.filter((l) => !chosen.has(l));
  if (
    indiaMissing.length > 0 &&
    indiaMissing.length <= 2 &&
    [...chosen].every((l) => india.includes(l)) &&
    chosen.size === india.length - indiaMissing.length
  ) {
    return `All India except ${indiaMissing.map(abbreviate).join(", ")}`;
  }
  if (missing.length > 0 && missing.length <= 2 && chosen.size > missing.length) {
    return `All except ${missing.map(abbreviate).join(", ")}`;
  }
  return [...chosen].map(abbreviate).join(", ");
}

/** The holidays of the roster, earliest first. */
export function holidayList(events: readonly RosterEvent[]): RosterEvent[] {
  return events
    .filter((e) => e.kind === "holiday")
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

const HINTS: readonly (readonly [RegExp, string])[] = [
  [/\b(blr|bengaluru|bangalore)\b/i, "Bengaluru"],
  [/\b(che|chennai)\b/i, "Chennai"],
  [/\b(gur|gurgaon|gurugram)\b/i, "Gurgaon"],
  [/\b(hyd|hyderabad)\b/i, "Hyderabad"],
  [/\b(kol|kolkata)\b/i, "Kolkata"],
  [/\b(mum|mumbai)\b/i, "Mumbai"],
  [/\b(pun|pune)\b/i, "Pune"],
  [/\b(mex|mexico)\b/i, "Mexico"],
];

/** The locations a workbook banner names: "HYD Only", "Ugadi (Blr,Hyd,Pun)", "KOL HOL",
 *  or, after "except", every India location but those named. Undefined when it names none. */
export function locationHint(label: string): string[] | undefined {
  const named = HINTS.filter(([pattern]) => pattern.test(label)).map(
    ([, place]) => place,
  );
  if (named.length === 0) return undefined;
  if (/\bexcept\b/i.test(label)) {
    const rest = INDIA_LOCATIONS.filter((l) => !named.includes(l));
    return rest.length > 0 ? rest : undefined;
  }
  return named;
}
