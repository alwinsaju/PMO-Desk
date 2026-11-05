// Reads the CSV that the Directory exports (and any similar comma-separated file) into rows of
// text, so it can go through the same importer as an Excel workbook. Pure.

/** Undoes the apostrophe the exports put in front of cells that start with = + - @ (see csvSafeCell). */
const unguard = (cell: string): string =>
  /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;

/** Parses CSV text: quoted cells (with "" for a quote and line breaks inside), CRLF, LF or CR line ends,
 *  and an optional byte-order mark. Semicolon-separated files (Excel in some regions) are read too. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(unguard(cell));
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
