"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { statusReport } from "@/lib/registers/reports";
import { ReportDialog } from "../ReportDialog";
import type { PanelProps } from "../RegisterApp";

const TONE = { Red: "text-red", Amber: "text-amber", Green: "text-success" } as const;

/** The weekly status report, built from each active project's RAG and notes. */
export function StatusReportPanel({ def, state, today }: PanelProps) {
  const [open, setOpen] = useState(false);
  const report = statusReport(state.items, def, today);
  const active = report.counts.Red + report.counts.Amber + report.counts.Green;
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
      <Button size="sm" disabled={active === 0} onClick={() => setOpen(true)}>
        Build the report
      </Button>
      {open && (
        <ReportDialog
          title="Weekly status report"
          subject={report.subject}
          text={report.text}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
