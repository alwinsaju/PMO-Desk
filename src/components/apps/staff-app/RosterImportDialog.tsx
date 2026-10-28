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
import { formatRange } from "@/lib/staff/dates";
import {
  findRosterSheet,
  parseRosterSheet,
  planRosterImport,
  type ParsedRoster,
} from "@/lib/staff/rosterImport";
import { useRosterStore } from "@/lib/staff/rosterStore";
import { useStaffStore } from "@/lib/staff/staffStore";
import { readWorkbookSheets } from "../tasks-app/readWorkbook";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function RosterImportDialog({
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
          <Body onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const config = useRosterStore((s) => s.config);
  const importPlan = useRosterStore((s) => s.importPlan);
  const employees = useStaffStore((s) => s.employees);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => (parsed ? planRosterImport(parsed, config, employees) : null),
    [parsed, config, employees],
  );

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    setParsed(null);
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) return setError("That file is larger than 20 MB.");
    setBusy(true);
    try {
      const sheet = findRosterSheet(await readWorkbookSheets(file));
      const result = sheet ? parseRosterSheet(sheet.data) : null;
      if (!result || result.members.length === 0) {
        setError(
          "No roster found. The sheet needs a “Resource” heading in column A, a row of dates, and people under their team headings.",
        );
      } else {
        setParsed(result);
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
    const result = await importPlan(plan.config, plan.upsert);
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    onClose();
  }

  return (
    <>
      <DialogTitle>Import a shift roster</DialogTitle>
      <DialogDescription>
        Reads the team&apos;s roster workbook (the “Resource” grid). People are matched by
        name. Days with an entry in the file replace what is there; days left blank in the
        file are not cleared.
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
              {busy && !parsed
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

        {plan && parsed && (
          <div className="bg-chip text-ink-soft rounded-card flex flex-col gap-1.5 px-4 py-3 text-[13px]">
            <p className="text-ink font-semibold">
              {formatRange(parsed.startDate, parsed.endDate)}
            </p>
            <p>
              {plan.stats.membersAdded} people to add, {plan.stats.membersUpdated} to
              update
              {plan.stats.membersLinked > 0 &&
                `, ${plan.stats.membersLinked} matched to a directory profile`}
            </p>
            <p>
              {plan.upsert.length.toLocaleString()} days of shifts, {plan.stats.events}{" "}
              holidays and notes
              {plan.stats.groupsAdded > 0 && `, ${plan.stats.groupsAdded} new teams`}
            </p>
            {plan.warnings.length > 0 && (
              <>
                <p className="text-amber mt-1 font-semibold">
                  {plan.warnings.length} kinds of entry could not be matched to a shift
                </p>
                <ul className="text-ink-muted list-disc pl-5 text-[12.5px]">
                  {plan.warnings.slice(0, 5).map((w) => (
                    <li key={`${w.reason}|${w.text}`}>
                      “{w.text}” × {w.count}: {w.reason.toLowerCase()}
                    </li>
                  ))}
                  {plan.warnings.length > 5 && (
                    <li>and {plan.warnings.length - 5} more</li>
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
        <Button disabled={!plan || busy} onClick={() => void run()}>
          Import
        </Button>
      </DialogFooter>
    </>
  );
}
