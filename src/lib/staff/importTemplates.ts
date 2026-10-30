// The blank workbooks offered by the Staff app's two Excel imports. Each is laid out the
// way its importer reads it, so a filled-in copy can be uploaded as it is. Every cell is
// optional except where a help sheet says otherwise; nothing here is an error to leave
// empty. Pure: the workbook comes out as sheet data for writeXlsx.
import { addDays, dayName, mondayOf } from "./dates.ts";
import { ROSTER_COLUMNS } from "./employees.ts";
import { STATUS_DEFS } from "./rosterCatalog.ts";
import type { CellValue, XlsxSheet } from "../xlsx/writeXlsx.ts";
import type { RosterConfig } from "./types.ts";

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
  config: Pick<RosterConfig, "schedules" | "groups" | "members">;
  /** Any day; the grid starts on that week's Monday. */
  today: string;
  days?: number;
}

const BLANK_ROWS_PER_TEAM = 6;

/** The shift roster import: the "Resource" grid, with the current teams and people
 *  already in it (and room for more) and the days left empty. */
export function rosterTemplate({
  config,
  today,
  days = 28,
}: RosterTemplateInput): XlsxSheet[] {
  const start = mondayOf(today);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));

  const grid: CellValue[][] = [
    ["Resource"],
    ["", "Name", "City", "Role", ...dates.map((date) => ({ date }))],
    ["", "", "", "", ...dates.map((date) => dayName(date))],
  ];
  const teams = config.groups.length
    ? config.groups.map((g) => ({ id: g.id, name: g.name }))
    : [{ id: "", name: "Team 1" }];
  for (const team of teams) {
    grid.push([team.name]);
    for (const m of config.members.filter((m) => m.groupId === team.id)) {
      grid.push(["", m.name, m.city, m.role]);
    }
    for (let i = 0; i < BLANK_ROWS_PER_TEAM; i++) grid.push([]);
  }

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
            text: "Fill in the Shift roster sheet, then import it in Staff Management > Shift roster > Import from Excel.",
            style: "note",
          },
        ],
        [
          {
            text: "Put each person's name in the Name column under their team heading (the heading is in the first column). City and Role are optional. Add more rows under a team as needed, or another team heading to add a team.",
            style: "note",
          },
        ],
        [
          {
            text: "In a day, type the shift name from the lists below, or a status. Leave a day blank to leave it as it is: blank days never clear what is already on the roster.",
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
