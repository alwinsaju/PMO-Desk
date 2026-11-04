"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { registerById } from "@/lib/registers/defs";
import { statusReport, type ReportRegisters } from "@/lib/registers/reports";
import { fetchRegister } from "../registersApi";
import { ReportDialog } from "../ReportDialog";
import type { PanelProps } from "../RegisterApp";

const TONE = { Red: "text-red", Amber: "text-amber", Green: "text-success" } as const;

/** Reads the RAID log and change requests fresh. Fails with a reason when either cannot be read,
 *  so the report never uses just one of them. */
async function readRegisters(): Promise<
  { ok: true; registers: ReportRegisters } | { ok: false; reason: string }
> {
  const raidDef = registerById("raid");
  const changesDef = registerById("changes");
  if (!raidDef || !changesDef) return { ok: false, reason: "The registers are missing." };
  const [raid, changes] = await Promise.all([
    fetchRegister("raid"),
    fetchRegister("changes"),
  ]);
  if (!raid.ok) return { ok: false, reason: `RAID log: ${raid.reason}` };
  if (!changes.ok) return { ok: false, reason: `Change requests: ${changes.reason}` };
  return {
    ok: true,
    registers: { raid: raid.items, raidDef, changes: changes.items, changesDef },
  };
}

/** The weekly status report, built from each active project's RAG and notes, plus its top open
 *  risks and late changes read from the RAID log and change requests. */
export function StatusReportPanel({ def, state, today }: PanelProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registers, setRegisters] = useState<ReportRegisters | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const report = statusReport(state.items, def, today, open ? registers : undefined);
  const active = report.counts.Red + report.counts.Amber + report.counts.Green;

  const build = async () => {
    setBusy(true);
    const read = await readRegisters();
    setBusy(false);
    setRegisters(read.ok ? read.registers : undefined);
    setProblem(read.ok ? null : read.reason);
    setOpen(true);
  };

  return (
    <div
      className="mx-6 mb-2 flex flex-wrap items-center gap-3"
      data-testid="status-report-panel"
    >
      <span className="text-ink-soft text-[13px]">
        Overall{" "}
        <span className={`font-bold ${TONE[report.overall]}`} data-testid="overall-rag">
          {report.overall.toUpperCase()}
        </span>{" "}
        · {report.counts.Red} red · {report.counts.Amber} amber · {report.counts.Green}{" "}
        green
      </span>
      <Button size="sm" disabled={active === 0 || busy} onClick={() => void build()}>
        {busy ? "Reading risks and changes..." : "Build the report"}
      </Button>
      {open && (
        <ReportDialog
          title="Weekly status report"
          description={
            problem
              ? `Could not read the RAID log or change requests (${problem}), so this report has no risks or late changes. Nothing is sent from here.`
              : "Includes each project's top open risks and late changes. Read it, copy it or open it as a mail draft. Nothing is sent from here."
          }
          subject={report.subject}
          text={report.text}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
