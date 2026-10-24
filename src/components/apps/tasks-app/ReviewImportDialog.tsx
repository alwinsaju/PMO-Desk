"use client";

import { useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { readWorkbookSheets } from "./readWorkbook";
import {
  parsePastedText,
  planImport,
  rowsFromSheets,
  type ImportRow,
} from "./reviewImport";
import type { ReviewIncident } from "./types";

interface ReviewImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live queue the import is validated against. */
  incidents: ReviewIncident[];
  options: string[];
  saving: boolean;
  /** Stages the validated resolutions; `save` also persists the full
   *  resolved set right away (the "Import & save" button). */
  onApply: (
    resolutions: { number: string; subcategory2: string }[],
    save: boolean,
  ) => Promise<void>;
}

/**
 * Bulk alternative to classifying incidents one by one: read Subcategory2
 * values from a workbook (parsed in the browser, nothing uploaded) or a
 * pasted two-column block, check every value against the queue's option
 * list, and show exactly what would be staged before anything is. Only
 * valid matches ever leave this dialog; the rest is listed so it can be
 * fixed at the source and re-imported.
 */
export function ReviewImportDialog({
  open,
  onOpenChange,
  incidents,
  options,
  saving,
  onApply,
}: ReviewImportDialogProps) {
  const [mode, setMode] = useState<"workbook" | "paste">("workbook");
  const [pasteText, setPasteText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<ImportRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => (mode === "paste" ? parsePastedText(pasteText) : (fileRows ?? [])),
    [mode, pasteText, fileRows],
  );
  const plan = useMemo(
    () => planImport(incidents, options, rows),
    [incidents, options, rows],
  );
  const hasInput = rows.length > 0;
  const sources = useMemo(
    () => [...new Set(rows.map((r) => r.source).filter(Boolean))].join(", "),
    [rows],
  );

  const reset = () => {
    setPasteText("");
    setFileName(null);
    setFileRows(null);
    setFileError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setFileRows(null);
    setFileError(null);
    setReading(true);
    try {
      const imported = rowsFromSheets(await readWorkbookSheets(file));
      if (imported.length === 0) {
        setFileError(
          "No incident Number + Subcategory2 columns with data were found in this workbook.",
        );
      }
      setFileRows(imported);
    } catch {
      setFileError("Couldn't read this file — is it an .xlsx workbook?");
    } finally {
      setReading(false);
    }
  };

  const apply = async (save: boolean) => {
    await onApply(plan.resolutions, save);
    reset();
    onOpenChange(false);
  };

  const matched = plan.resolutions.length;
  const newCount = plan.newLabels.reduce((sum, item) => sum + item.count, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="scroll-thin flex max-h-[85vh] max-w-xl flex-col overflow-y-auto px-[30px] pt-7 pb-6">
        <DialogTitle>Import Subcategory2 values</DialogTitle>
        <DialogDescription>
          Fill in many incidents at once. Values are checked against the category list
          before anything is staged.
        </DialogDescription>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as "workbook" | "paste")}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="workbook">From workbook</TabsTrigger>
            <TabsTrigger value="paste">Paste</TabsTrigger>
          </TabsList>

          <TabsContent value="workbook" className="mt-3 flex flex-col gap-2">
            <p className="text-ink-muted text-[13px]">
              Choose the .xlsx you filled in (e.g.{" "}
              <code className="font-mono">prepared-incidents.xlsx</code>). The{" "}
              <em>Review Needed</em> sheet is read first, then <em>Incidents</em>, using
              the Number and Subcategory2 columns. It&apos;s read here in your browser —
              nothing is uploaded.
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <Button
                variant="outline"
                disabled={reading}
                onClick={() => fileInput.current?.click()}
              >
                {reading
                  ? "Reading…"
                  : fileName
                    ? "Choose another file"
                    : "Choose workbook…"}
              </Button>
              {fileName && (
                <span className="text-ink-muted line-clamp-1 text-[12.5px]">
                  {fileName}
                </span>
              )}
            </div>
            {fileError && <p className="text-red text-[13px]">{fileError}</p>}
          </TabsContent>

          <TabsContent value="paste" className="mt-3 flex flex-col gap-2">
            <p className="text-ink-muted text-[13px]">
              Paste two columns — incident number, then Subcategory2 — straight from Excel
              (or comma-separated). A header row is optional.
            </p>
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"INC4415807\tHardware Issue\nINC4415808\tOther"}
              spellCheck={false}
              className="rounded-control border-line-strong bg-field text-ink placeholder:text-ink-muted focus-visible:border-focus focus-visible:shadow-field-focus h-32 w-full resize-y border p-3.5 font-mono text-[12.5px] transition-[border-color,box-shadow] duration-[250ms] focus-visible:outline-none"
            />
          </TabsContent>
        </Tabs>

        {hasInput && (
          <div className="border-line bg-card rounded-card mt-4 flex flex-col gap-2 border p-4">
            <p className="text-ink text-[13px]">
              <strong className="font-semibold">{matched}</strong> to stage (
              {matched - newCount} existing categories, {plan.newLabels.length} new label
              {plan.newLabels.length === 1 ? "" : "s"}){" · "}
              {plan.notInQueue.length} not in queue
              {" · "}
              {plan.stillBlank.length} still blank
            </p>
            {sources && mode === "workbook" && (
              <p className="text-ink-muted text-xs">Read from: {sources}</p>
            )}
            {plan.overwrites > 0 && (
              <p className="text-ink-muted text-xs">
                {plan.overwrites} already-chosen value{plan.overwrites === 1 ? "" : "s"}{" "}
                will be replaced by this import.
              </p>
            )}
            {plan.duplicates > 0 && (
              <p className="text-ink-muted text-xs">
                {plan.duplicates} incident
                {plan.duplicates === 1 ? " appears" : "s appear"} more than once with
                different values — the last one is used.
              </p>
            )}
            <p className="text-ink-muted text-xs">
              Blank cells and &ldquo;skip&rdquo; stay pending.
            </p>

            {plan.newLabels.length > 0 && (
              <div className="bg-accent-soft rounded-card flex flex-col gap-1.5 p-3.5">
                <p className="text-ink text-[13px] font-semibold">
                  {plan.newLabels.length} new label
                  {plan.newLabels.length === 1 ? "" : "s"} — not in the existing category
                  list
                </p>
                <p className="text-ink-muted text-xs">
                  These will be saved exactly as written and appear as new categories in
                  the report. Check for typos before saving.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {plan.newLabels.map((item) => (
                    <Badge key={item.label} variant="accent">
                      {item.label} ×{item.count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {plan.notInQueue.length > 0 && (
              <ScrollArea className="border-line rounded-card h-32 border">
                <div className="flex flex-col gap-0.5 p-2.5 text-xs">
                  {plan.notInQueue.map((item) => (
                    <p key={`n-${item.number}`} className="text-ink-muted">
                      <span className="text-ink font-mono">{item.number}</span> — not in
                      this review queue
                    </p>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={matched === 0 || saving}
            onClick={() => apply(false)}
          >
            {matched ? `Stage ${matched}` : "Stage"}
          </Button>
          <Button disabled={matched === 0 || saving} onClick={() => apply(true)}>
            {saving ? "Saving…" : "Import & save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
