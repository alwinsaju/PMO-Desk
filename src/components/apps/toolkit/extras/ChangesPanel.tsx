"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { changeSummary } from "@/lib/registers/reports";
import { ReportDialog } from "../ReportDialog";
import type { PanelProps } from "../RegisterApp";

/** The weekly change summary: counts, what waits for a decision, what is past its date. */
export function ChangesPanel({ def, state, today }: PanelProps) {
  const [open, setOpen] = useState(false);
  const summary = changeSummary(state.items, def, today);
  return (
    <div className="mx-6 mb-2 flex items-center gap-2" data-testid="changes-panel">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Weekly summary
      </Button>
      <span className="text-ink-muted text-[12.5px]">
        {Object.entries(summary.counts)
          .map(([status, n]) => `${n} ${status.toLowerCase()}`)
          .join(" · ") || "No change requests yet"}
      </span>
      {open && (
        <ReportDialog
          title="Weekly change summary"
          subject={summary.subject}
          text={summary.text}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
