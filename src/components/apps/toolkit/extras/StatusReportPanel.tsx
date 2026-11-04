"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useMyFirstName } from "@/components/people/useMyFirstName";
import { registerById } from "@/lib/registers/defs";
import { statusReport, type ReportRegisters } from "@/lib/registers/reports";
import { weeklyPack, type WeeklyPack } from "@/lib/registers/weeklyPack";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { useTemplateText } from "../../templates-app/useTemplateText";
import { fetchRegister } from "../registersApi";
import { ReportDialog } from "../ReportDialog";
import type { PanelProps } from "../RegisterApp";

const TONE = { Red: "text-red", Amber: "text-amber", Green: "text-success" } as const;

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One register, read fresh, with the name the failure message uses. */
async function readOne(
  id: string,
  label: string,
): Promise<Read<{ def: RegisterDef; items: RegisterRecord[] }>> {
  const def = registerById(id);
  if (!def) return { ok: false, reason: "The registers are missing." };
  const reply = await fetchRegister(id);
  return reply.ok
    ? { ok: true, value: { def, items: reply.items } }
    : { ok: false, reason: `${label}: ${reply.reason}` };
}

/** Reads the RAID log and change requests fresh. Fails with a reason when either cannot be read,
 *  so the report never uses just one of them. */
async function readRegisters(): Promise<
  { ok: true; registers: ReportRegisters } | { ok: false; reason: string }
> {
  const [raid, changes] = await Promise.all([
    readOne("raid", "RAID log"),
    readOne("changes", "Change requests"),
  ]);
  if (!raid.ok) return raid;
  if (!changes.ok) return changes;
  return {
    ok: true,
    registers: {
      raid: raid.value.items,
      raidDef: raid.value.def,
      changes: changes.value.items,
      changesDef: changes.value.def,
    },
  };
}

/** The weekly status report, built from each active project's RAG and notes, plus its top open
 *  risks and late changes read from the RAID log and change requests. The weekly pack joins that
 *  with a change summary, a RAID summary and the governance events coming up. */
export function StatusReportPanel({ def, state, today }: PanelProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registers, setRegisters] = useState<ReportRegisters | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [pack, setPack] = useState<WeeklyPack | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packProblem, setPackProblem] = useState<string | null>(null);
  const me = useMyFirstName();
  const report = statusReport(state.items, def, today, open ? registers : undefined);
  const active = report.counts.Red + report.counts.Amber + report.counts.Green;
  // The wording is the Templates app's "Toolkit weekly status report" when one is set, else the built-in text.
  const statusText = useTemplateText("app:toolkit:status-report", open);
  const written = statusText.fill(
    { ...report.values, my_name: me },
    { subject: report.subject, body: report.text },
  );

  const build = async () => {
    setBusy(true);
    const read = await readRegisters();
    setBusy(false);
    setRegisters(read.ok ? read.registers : undefined);
    setProblem(read.ok ? null : read.reason);
    setOpen(true);
  };

  const buildPack = async () => {
    setPackBusy(true);
    setPackProblem(null);
    const [raid, changes, governance] = await Promise.all([
      readOne("raid", "RAID log"),
      readOne("changes", "Change requests"),
      readOne("governance", "Governance calendar"),
    ]);
    setPackBusy(false);
    const failed = [raid, changes, governance].find((r) => !r.ok);
    if (failed && !failed.ok) {
      // A pack with one part silently missing would read as "nothing to report".
      setPackProblem(`Could not build the pack. ${failed.reason}`);
      return;
    }
    if (!raid.ok || !changes.ok || !governance.ok) return;
    setPack(
      weeklyPack({
        projects: state.items,
        projectsDef: def,
        raid: raid.value.items,
        raidDef: raid.value.def,
        changes: changes.value.items,
        changesDef: changes.value.def,
        governance: governance.value.items,
        governanceDef: governance.value.def,
        today,
      }),
    );
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
      <Button
        size="sm"
        variant="outline"
        disabled={packBusy}
        onClick={() => void buildPack()}
        data-testid="weekly-pack-button"
      >
        {packBusy ? "Reading the registers..." : "Weekly pack"}
      </Button>
      {packProblem && (
        <span role="alert" className="text-red text-[12.5px]">
          {packProblem}
        </span>
      )}
      {open && (
        <ReportDialog
          title="Weekly status report"
          description={
            problem
              ? `Could not read the RAID log or change requests (${problem}), so this report has no risks or late changes. Nothing is sent from here.`
              : "Includes each project's top open risks and late changes. Read it, copy it or open it as a mail draft. Nothing is sent from here."
          }
          subject={written.subject}
          text={written.body}
          onUse={statusText.used}
          onClose={() => setOpen(false)}
        />
      )}
      {pack && (
        <ReportDialog
          title="Weekly pack"
          description={`The status report, change summary, RAID summary and governance events in one text. ${
            pack.grouped
              ? "Change requests and RAID items are grouped by their Project."
              : "No RAID item or change request has a Project yet, so they are listed together."
          } Copy it or open it as a mail draft. Nothing is sent from here.`}
          subject={pack.subject}
          text={pack.text}
          onClose={() => setPack(null)}
        />
      )}
    </div>
  );
}
