import type { SheetData } from "./reviewImport";

/**
 * Reads every sheet of an .xlsx entirely in the browser — the file never
 * leaves the machine. The spreadsheet library is loaded on demand (it's
 * only needed when someone actually imports a workbook) and via its
 * "universal" entry, which parses on the calling thread and so needs no
 * Web Worker plumbing in the bundler. Parsing a month's ~6k-row export
 * takes about half a second.
 */
export async function readWorkbookSheets(file: Blob): Promise<SheetData[]> {
  const { default: readExcelFile } = await import("read-excel-file/universal");
  const sheets = await readExcelFile(file);
  return sheets.map(({ sheet, data }) => ({ sheet, data }));
}
