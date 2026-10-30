// The blank workbook offered by "Import Subcategory2 values": the incidents waiting in the
// review queue, with the Subcategory2 column empty to fill in, and the allowed values on a
// second sheet. It is laid out the way rowsFromSheets reads it (a "Review Needed" sheet
// with Number and Subcategory2 columns). Nothing has to be filled in. Pure.
import type { CellValue, XlsxSheet } from "@/lib/xlsx/writeXlsx";
import type { ReviewIncident } from "./types";

const HEADERS = [
  "Number",
  "Short description",
  "Category",
  "Subcategory",
  "Assignment group",
  "Why it needs review",
  "Subcategory2",
];

export function reviewTemplate(
  incidents: readonly ReviewIncident[],
  options: readonly string[],
): XlsxSheet[] {
  const rows: CellValue[][] = [
    HEADERS,
    ...incidents.map((i) => [
      i.number,
      i.short_description ?? "",
      i.category ?? "",
      i.subcategory ?? "",
      i.assignment_group ?? "",
      i.review_reasons.join("; "),
      i.resolved_subcategory2 ?? "",
    ]),
  ];
  return [
    {
      name: "Review Needed",
      rows,
      widths: [16, 50, 18, 18, 22, 30, 26],
      headerRows: [0],
      freeze: { rows: 1 },
    },
    {
      name: "Subcategory2 options",
      rows: [
        ["Allowed Subcategory2 values"],
        ...options.map((o) => [o]),
        [],
        [
          {
            text: "Type one of these in the Subcategory2 column of the Review Needed sheet. A value that is not on this list is shown as a new label before anything is staged. Leave a row blank to skip it.",
            style: "note",
          },
        ],
      ],
      widths: [60],
      headerRows: [0],
    },
  ];
}
