// A small .xlsx writer for the import templates. Pure (no Node or DOM APIs), so the
// browser builds the file itself and nothing leaves the computer. It writes what the
// templates need: text, numbers, dates, a bold header row, column widths and a frozen
// header. The zip is stored (not compressed); these files are a few kilobytes.

export interface XlsxCell {
  text?: string;
  number?: number;
  /** yyyy-mm-dd, written as a real Excel date (shown as a header, like the day heading it is). */
  date?: string;
  style?: "header" | "note";
}

export type CellValue = string | number | null | undefined | XlsxCell;

export interface XlsxSheet {
  name: string;
  rows: readonly (readonly CellValue[])[];
  /** Column widths in characters. */
  widths?: readonly number[];
  /** Rows (0-based) drawn as a header. */
  headerRows?: readonly number[];
  /** Rows and columns kept in view while scrolling. */
  freeze?: { rows?: number; cols?: number };
}

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const STYLE = { plain: 0, header: 1, date: 2, note: 3 } as const;

const escapeXml = (text: string): string =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const columnLetters = (index: number): string => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** Excel's day number for a yyyy-mm-dd date (1900 system), or null when it is not one. */
export function excelSerial(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000) + 25569;
}

/** Sheet names Excel accepts: at most 31 characters, none of []:*?/\ , not empty. */
export function safeSheetName(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  return candidate;
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="ddd\\ d\\ mmm\\ yyyy"/></numFmts>' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><i/><sz val="11"/><color rgb="FF5F6B7A"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E8E1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

class Strings {
  private index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;
  id(text: string): number {
    this.count++;
    const known = this.index.get(text);
    if (known !== undefined) return known;
    this.index.set(text, this.list.length);
    this.list.push(text);
    return this.list.length - 1;
  }
}

function sheetXml(sheet: XlsxSheet, strings: Strings): string {
  const headers = new Set(sheet.headerRows ?? []);
  const rows: string[] = [];
  sheet.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((value, c) => {
      if (value === null || value === undefined || value === "") return;
      const cell: XlsxCell =
        typeof value === "string"
          ? { text: value }
          : typeof value === "number"
            ? { number: value }
            : value;
      const style = STYLE[cell.style ?? (headers.has(r) ? "header" : "plain")];
      const ref = `${columnLetters(c)}${r + 1}`;
      const serial = cell.date === undefined ? null : excelSerial(cell.date);
      if (serial !== null) {
        cells.push(`<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`);
      } else if (cell.number !== undefined && Number.isFinite(cell.number)) {
        cells.push(`<c r="${ref}" s="${style}"><v>${cell.number}</v></c>`);
      } else {
        const text = cell.text ?? cell.date ?? "";
        if (text === "") return;
        cells.push(`<c r="${ref}" s="${style}" t="s"><v>${strings.id(text)}</v></c>`);
      }
    });
    if (cells.length) rows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  });

  const xSplit = sheet.freeze?.cols ?? 0;
  const ySplit = sheet.freeze?.rows ?? 0;
  const pane =
    xSplit || ySplit
      ? `<pane${xSplit ? ` xSplit="${xSplit}"` : ""}${ySplit ? ` ySplit="${ySplit}"` : ""} topLeftCell="${columnLetters(xSplit)}${ySplit + 1}" activePane="${xSplit && ySplit ? "bottomRight" : ySplit ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rows.join("")}</sheetData></worksheet>`
  );
}

// ---------------------------------------------------------------------------
// Zip (stored entries)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function storeZip(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const sum = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(14, DOS_DATE, true);
    head.setUint32(16, sum, true);
    head.setUint32(20, entry.data.length, true);
    head.setUint32(24, entry.data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Builds the workbook. At least one sheet; names are made safe and unique. */
export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet.");
  const taken = new Set<string>();
  const named = sheets.map((sheet) => {
    const name = safeSheetName(sheet.name, taken);
    taken.add(name.toLowerCase());
    return { ...sheet, name };
  });
  const strings = new Strings();
  const sheetFiles = named.map((sheet) => sheetXml(sheet, strings));
  const encoder = new TextEncoder();
  const xml = (text: string) => encoder.encode(text);
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const sharedStrings =
    `${head}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.count}" uniqueCount="${strings.list.length}">` +
    strings.list
      .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
      .join("") +
    "</sst>";

  const contentTypes =
    `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    named
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    "</Types>";

  const rootRels =
    `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

  const workbook =
    `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    "<sheets>" +
    named
      .map(
        (sheet, i) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("") +
    "</sheets></workbook>";

  const workbookRels =
    `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    named
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${named.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    "</Relationships>";

  return storeZip([
    { name: "[Content_Types].xml", data: xml(contentTypes) },
    { name: "_rels/.rels", data: xml(rootRels) },
    { name: "xl/workbook.xml", data: xml(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(workbookRels) },
    ...sheetFiles.map((file, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: xml(file),
    })),
    { name: "xl/styles.xml", data: xml(STYLES_XML) },
    { name: "xl/sharedStrings.xml", data: xml(sharedStrings) },
  ]);
}
