// The blank workbooks offered by the Staff app's two Excel imports. Each is laid out the
// way its importer reads it, so a filled-in copy can be uploaded as it is. Every cell is
// optional except where a help sheet says otherwise; nothing here is an error to leave
// empty. Pure: the workbook comes out as sheet data for writeXlsx.
import { addDays, dayName, daysBetween, mondayOf } from "./dates.ts";
import { ROSTER_COLUMNS, displayName } from "./employees.ts";
import { STATUS_DEFS } from "./rosterCatalog.ts";
import { assignmentId, buildSections, cellText, indexAssignments } from "./shifts.ts";
import type { CellValue, XlsxSheet } from "../xlsx/writeXlsx.ts";
import type { Employee, RosterConfig, RosterEvent, ShiftAssignment } from "./types.ts";

const HELP: Record<string, string> = {
  firstName: "Optional. Filled in from Microsoft 365 once the person is added.",
  lastName: "Optional. Filled in from Microsoft 365 once the person is added.",
  milestone: "Optional. A number or short label.",
  deloitteEmail:
    "The one column every row needs: the person's Deloitte email. Rows without it are skipped.",
  rollOffDate: "Optional. A date, for example 2026-12-31 or 31 Dec 2026.",
  campus: "Optional. Yes or No.",
  location: "Optional. Onshore or Offshore.",
  homeOffice: "Optional. Filled in from Microsoft 365.",
  level: "Optional. Filled in from Microsoft 365.",
  offering: "Optional.",
  op: "Optional. The offering portfolio. Filled in from Microsoft 365.",
  team: "Optional. The team the person works in; it becomes their team on the shift roster.",
  phone: "Optional. Filled in from Microsoft 365.",
  skills: "Optional. Separate several with commas.",
  deloittePersonId: "Optional.",
  takedaEmail: "Optional.",
  staffitStartDate: "Optional. A date.",
  staffitEndDate: "Optional. A date.",
  contractEndDate: "Optional. A date.",
  networkId: "Optional.",
  workdayId: "Optional.",
  clientManager: "Optional.",
  excludeFromShiftRoster: "Optional. Yes keeps the person off the shift roster.",
};

const TEMPLATE_COLUMNS = ROSTER_COLUMNS.filter(
  (c) => c.key !== "fullName" && c.key !== "gender",
);

/** The directory import: one heading row to fill in, and a sheet that explains each column. */
export function employeeTemplate(): XlsxSheet[] {
  return [
    {
      name: "Staff roster",
      rows: [TEMPLATE_COLUMNS.map((c) => c.header)],
      widths: TEMPLATE_COLUMNS.map((c) => Math.max(14, c.header.length + 4)),
      headerRows: [0],
      freeze: { rows: 1 },
    },
    {
      name: "How to fill in",
      rows: [
        [
          {
            text: "Fill in one person per row on the Staff roster sheet, then import it in Staff Management > Directory > Import from Excel.",
            style: "note",
          },
        ],
        [
          {
            text: "Only the Deloitte email is needed. Leave any other cell blank: people already in the directory keep what they have, and Microsoft 365 fills in the rest.",
            style: "note",
          },
        ],
        [],
        [
          { text: "Column", style: "header" },
          { text: "What to put in it", style: "header" },
        ],
        // The " column" suffix keeps these cells from being read as headings by the importer.
        ...TEMPLATE_COLUMNS.map((c) => [
          `${c.header} column`,
          HELP[c.key] ?? "Optional.",
        ]),
      ],
      widths: [28, 90],
    },
  ];
}

export interface RosterTemplateInput {
  config: Pick<RosterConfig, "schedules" | "groups" | "members"> & {
    events?: readonly RosterEvent[];
  };
  /** Any day; the grid covers that day's calendar year. */
  today: string;
  /** The shifts already on the roster, written into the grid. */
  shifts?: readonly ShiftAssignment[];
  /** The directory: people on it but not yet on the roster get a row too. */
  employees?: readonly Employee[];
  /** A grid of this many days from that week's Monday instead of the whole year. */
  days?: number;
}

const BLANK_ROWS_PER_TEAM = 6;
/** Existing shifts outside the year stretch the grid, but never past this many days. */
const MAX_GRID_DAYS = 800;

/** The days the grid covers: the calendar year, stretched to hold every day that already
 *  has a shift or a holiday (unless that would make the sheet unreasonably long). */
function gridDates(
  today: string,
  days: number | undefined,
  edges: readonly string[],
): string[] {
  if (days !== undefined) {
    const start = mondayOf(today);
    return Array.from({ length: days }, (_, i) => addDays(start, i));
  }
  const year = today.slice(0, 4);
  let first = `${year}-01-01`;
  let last = `${year}-12-31`;
  for (const date of edges) {
    if (date < first) first = date;
    if (date > last) last = date;
  }
  if (daysBetween(first, last) + 1 > MAX_GRID_DAYS) {
    first = `${year}-01-01`;
    last = `${year}-12-31`;
  }
  return Array.from({ length: daysBetween(first, last) + 1 }, (_, i) =>
    addDays(first, i),
  );
}

/** The shift roster import: the "Resource" grid for the whole year, with the teams,
 *  people, shifts and holidays that are already on the roster filled in (and room for
 *  more), so a copy that is added to can be imported back as it is. */
export function rosterTemplate({
  config,
  today,
  shifts = [],
  employees = [],
  days,
}: RosterTemplateInput): XlsxSheet[] {
  const events = config.events ?? [];
  const dates = gridDates(today, days, [
    ...shifts.map((a) => a.date),
    ...events.map((e) => e.date),
  ]);
  const index = indexAssignments(shifts);

  // The first holiday of each day is written in the banner row. Importing it back is a
  // no-op: a holiday already on the roster (same day, same words) is not added again.
  const banners = new Map<string, string>();
  for (const e of events) if (!banners.has(e.date)) banners.set(e.date, e.label);

  const grid: CellValue[][] = [
    ["Resource", null, null, null, ...dates.map((date) => banners.get(date) ?? null)],
    ["", "Name", "City", "Role", ...dates.map((date) => ({ date }))],
    ["", "", "", "", ...dates.map((date) => dayName(date))],
  ];

  const { sections } = buildSections({ ...config, events: [...events] }, employees, {
    showHidden: true,
  });
  const excluded = new Set(
    employees.filter((e) => e.excludeFromShiftRoster).map((e) => e.id),
  );
  const storedIds = new Set(config.groups.map((g) => g.id));
  const written = new Set<string>();
  const blanks = () => {
    for (let i = 0; i < BLANK_ROWS_PER_TEAM; i++) grid.push([]);
  };
  const dayCells = (memberId: string | undefined): CellValue[] =>
    dates.map((date) => {
      const a = memberId ? index.get(assignmentId(memberId, date)) : undefined;
      return (a && cellText(a, config.schedules)) || null;
    });
  const section = (name: string, rows: CellValue[][]) => {
    grid.push([name], ...rows);
    written.add(name);
    blanks();
  };
  // Directory people who have no shifts yet are listed under the team their profile names,
  // so shifts can be typed in for them. A person whose profile names no team is left out
  // (nothing is lost) until one is given.
  const directoryRows = (id: string): CellValue[][] =>
    (sections.find((s) => s.id === id)?.rows ?? [])
      .filter((r) => !r.member && r.employee)
      .map((r) => [
        "",
        displayName(r.employee!),
        r.employee!.homeOffice,
        "",
        ...dayCells(undefined),
      ]);

  // Roster members stay under the team they are stored in, so importing them back
  // changes nothing about them.
  for (const group of config.groups) {
    const members = config.members.filter(
      (m) => m.groupId === group.id && !(m.employeeId && excluded.has(m.employeeId)),
    );
    section(group.name, [
      ...members.map((m) => ["", m.name, m.city, m.role, ...dayCells(m.id)]),
      ...directoryRows(group.id),
    ]);
  }
  for (const s of sections) {
    if (!s.group || storedIds.has(s.id)) continue;
    section(s.group.name, directoryRows(s.id));
  }
  if (written.size === 0) section("Team 1", []);

  const shiftRows: CellValue[][] = config.schedules.flatMap((s) => [
    [
      { text: s.name, style: "header" as const },
      { text: "Hours", style: "header" as const },
    ],
    ...s.shifts.map((d) => [d.label, `${d.start} to ${d.end}`]),
    [],
  ]);

  return [
    {
      name: "Shift roster",
      rows: grid,
      widths: [20, 26, 14, 18, ...dates.map(() => 13)],
      headerRows: [0, 1, 2],
      freeze: { rows: 3, cols: 4 },
    },
    {
      name: "How to fill in",
      rows: [
        [
          {
            text: "This workbook covers the whole year and already holds the teams, people, shifts and holidays that are on the roster today. Add to it, then import it in Staff Management > Shift roster > Import from Excel.",
            style: "note",
          },
        ],
        [
          {
            text: "Only what differs from the roster is applied: a day you type over is changed, a day you fill in is added, and everything you leave alone stays as it is. Blank days never clear what is already on the roster.",
            style: "note",
          },
        ],
        [
          {
            text: "Put each new person's name in the Name column under their team heading (the heading is in the first column). City and Role are optional. Add more rows under a team as needed, or another team heading to add a team. People with no team on their Directory profile are not listed.",
            style: "note",
          },
        ],
        [
          {
            text: "In a day, type the shift name from the lists below, or a status. The row above the dates holds holidays and notes; type one on its day to add it.",
            style: "note",
          },
        ],
        [],
        [
          { text: "Status", style: "header" },
          { text: "What it means", style: "header" },
        ],
        ...STATUS_DEFS.map((s) => [s.short, s.description]),
        [],
        ...shiftRows,
      ],
      widths: [24, 70],
    },
  ];
}
