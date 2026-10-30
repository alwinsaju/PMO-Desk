"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { downloadXlsx } from "@/lib/xlsx/download";
import type { XlsxSheet } from "@/lib/xlsx/writeXlsx";

/** "Download a blank template": builds the workbook on this computer and saves it. */
export function TemplateDownloadButton({
  fileName,
  sheets,
  label = "Download a blank template",
}: {
  fileName: string;
  /** Called when clicked, so the workbook reflects what the app holds right now. */
  sheets: () => XlsxSheet[];
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="self-start"
      onClick={() => downloadXlsx(fileName, sheets())}
    >
      <DownloadSimpleIcon size={16} weight="bold" />
      {label}
    </Button>
  );
}
