"use client";

import { useMemo, useRef, useState } from "react";
import { FileXlsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { cn } from "@/lib/cn";
import { parseRosterRows, planImport, type ImportResult } from "@/lib/staff/employees";
import { employeeTemplate } from "@/lib/staff/importTemplates";
import { useStaffStore } from "@/lib/staff/staffStore";
import { TemplateDownloadButton } from "../TemplateDownloadButton";
import { readWorkbookSheets } from "../tasks-app/readWorkbook";
import { DialogHead, DialogScroll, FormSection, StickyFooter } from "./FormParts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <ImportBody onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ImportBody({ onClose }: { onClose: () => void }) {
  const employees = useStaffStore((s) => s.employees);
  const commit = useStaffStore((s) => s.commit);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const plan = useMemo(
    () => (result ? planImport(employees, result.rows) : null),
    [result, employees],
  );

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) return setError("That file is larger than 10 MB.");
    setBusy(true);
    try {
      const sheets = await readWorkbookSheets(file);
      const parsed = sheets
        .map((sheet) => parseRosterRows(sheet.data))
        .find((candidate) => candidate.headerFound);
      if (!parsed) {
        setError(
          "No roster columns found. The first rows need headings such as First Name, Last Name and Deloitte Email- id.",
        );
      } else {
        setResult(parsed);
      }
    } catch {
      setError("That file could not be read. Is it an .xlsx workbook?");
    } finally {
      setBusy(false);
    }
  }

  /** Same reader as the picker (and so the same 10 MB cap); only the first dropped file is used. */
  const take = (list: FileList | null | undefined) => {
    void read(list?.[0]);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function run() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const saved = await commit("employees", { upsert: plan.upserts });
    setBusy(false);
    if (!saved.ok) return setError(saved.reason);
    onClose();
  }

  const count = plan?.upserts.length ?? 0;
  return (
    <>
      <DialogHead
        title="Import from Excel"
        description="Use the Staff roster template (download a blank one below). People are matched by Deloitte email: existing ones are updated with the cells that have a value, new ones are added. Everyone added or entered by hand is then looked up in Microsoft 365, which fills in name, level, offering portfolio, home office, phone and the picture."
      />
      <DialogScroll>
        <div className="grid gap-5 sm:grid-cols-2 [&>fieldset]:mt-0">
          <FormSection title="1. Choose the file">
            <div className="flex flex-col gap-4 sm:col-span-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => {
                  if (busy) return;
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (!busy) take(event.dataTransfer.files);
                }}
                className={cn(
                  "transition-ui rounded-card focus-ring flex items-center gap-3 border px-4 py-4 text-left",
                  dragging
                    ? "border-focus bg-accent-soft border-solid"
                    : "border-line-strong hover:bg-chip border-dashed",
                )}
              >
                <FileXlsIcon size={28} className="text-accent-ink shrink-0" />
                <span className="min-w-0">
                  <span className="text-ink block truncate text-[14px] font-semibold">
                    {fileName || "Choose a workbook (.xlsx)"}
                  </span>
                  <span className="text-ink-muted text-[12.5px]">
                    {busy && !result
                      ? "Reading…"
                      : "Drop a file here, or click to choose. Read on this computer; it is not uploaded anywhere."}
                  </span>
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => take(e.target.files)}
              />
              <TemplateDownloadButton
                fileName="staff-roster-template.xlsx"
                sheets={employeeTemplate}
              />
            </div>
          </FormSection>

          <FormSection title="2. Check the result">
            <div className="flex flex-col gap-3 sm:col-span-2" aria-live="polite">
              {plan && result ? (
                <>
                  <dl className="grid grid-cols-3 gap-2">
                    {[
                      ["To add", plan.added, "text-success"],
                      ["To update", plan.updated, "text-info"],
                      ["Skipped", result.skipped.length, "text-amber"],
                    ].map(([label, value, tone]) => (
                      <div
                        key={label as string}
                        className="bg-chip rounded-card px-3 py-2"
                      >
                        <dt className="text-ink-muted text-[12px]">{label}</dt>
                        <dd className={`text-[22px] leading-tight font-bold ${tone}`}>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {result.skipped.length > 0 && (
                    <ul className="text-ink-muted list-disc pl-5 text-[12.5px]">
                      {result.skipped.slice(0, 5).map((skip) => (
                        <li key={skip.row}>
                          Row {skip.row}: {skip.reason}
                        </li>
                      ))}
                      {result.skipped.length > 5 && (
                        <li>and {result.skipped.length - 5} more</li>
                      )}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-ink-muted text-[13px]">
                  Choose a workbook to see how many people will be added or updated, and
                  which rows are skipped.
                </p>
              )}
              {error && (
                <p role="alert" className="text-red flex items-start gap-2 text-[13px]">
                  <WarningCircleIcon size={16} className="mt-px shrink-0" />
                  {error}
                </p>
              )}
            </div>
          </FormSection>
        </div>
      </DialogScroll>

      <StickyFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={count === 0 || busy} onClick={() => void run()}>
          {count > 0 ? `Import ${count} ${count === 1 ? "person" : "people"}` : "Import"}
        </Button>
      </StickyFooter>
    </>
  );
}
