"use client";

import { useMemo, useRef, useState } from "react";
import { FileXlsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui";
import { parseRosterRows, planImport, type ImportResult } from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import { readWorkbookSheets } from "../tasks-app/readWorkbook";

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
        <DialogContent className="max-w-lg">
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
      <DialogTitle>Import from Excel</DialogTitle>
      <DialogDescription>
        Use the Staff roster template. People are matched by Deloitte email: existing ones
        are updated with the cells that have a value, new ones are added.
      </DialogDescription>

      <div className="mt-5 flex flex-col gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="border-line-strong hover:bg-chip transition-ui rounded-card flex items-center gap-3 border border-dashed px-4 py-4 text-left"
        >
          <FileXlsIcon size={28} className="text-accent-ink shrink-0" />
          <span className="min-w-0">
            <span className="text-ink block truncate text-[14px] font-semibold">
              {fileName || "Choose a workbook (.xlsx)"}
            </span>
            <span className="text-ink-muted text-[12.5px]">
              {busy && !result
                ? "Reading…"
                : "Read on this computer; it is not uploaded anywhere."}
            </span>
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {plan && result && (
          <div className="bg-chip text-ink-soft rounded-card flex flex-col gap-1.5 px-4 py-3 text-[13px]">
            <p className="text-ink font-semibold">
              {plan.added} to add, {plan.updated} to update
            </p>
            {result.skipped.length > 0 && (
              <>
                <p>
                  {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"}{" "}
                  skipped:
                </p>
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
              </>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-red flex items-start gap-2 text-[13px]">
            <WarningCircleIcon size={16} className="mt-px shrink-0" />
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={count === 0 || busy} onClick={() => void run()}>
          {count > 0 ? `Import ${count} ${count === 1 ? "person" : "people"}` : "Import"}
        </Button>
      </DialogFooter>
    </>
  );
}
