"use client";

import { buildXlsx, XLSX_MIME, type XlsxSheet } from "./writeXlsx";

/** Builds the workbook in the browser and hands it over as a download (a save dialog in the desktop app). */
export function downloadXlsx(fileName: string, sheets: readonly XlsxSheet[]): void {
  const bytes = buildXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
