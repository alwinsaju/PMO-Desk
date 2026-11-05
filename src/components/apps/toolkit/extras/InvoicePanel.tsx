"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { monthEndCheck } from "@/lib/registers/reports";
import { ReportDialog } from "../ReportDialog";
import type { PanelProps } from "../RegisterApp";

/** Month-end check: which unsent invoices for a month can go and what holds the others back. */
export function InvoicePanel({ def, state, today }: PanelProps) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [open, setOpen] = useState(false);
  const check = monthEndCheck(state.items, def, month, today);
  return (
    <div
      className="mx-6 mb-2 flex flex-wrap items-center gap-2"
      data-testid="invoice-panel"
    >
      <label className="text-ink-soft flex items-center gap-2 text-[12.5px] font-semibold">
        Month-end check for
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Month"
          className="w-40"
        />
      </label>
      <span className="text-ink-muted text-[12.5px]" data-testid="month-end-line">
        {!check.valid
          ? "Pick a month to see which invoices are ready."
          : `${check.ready} ready · ${check.blocked} blocked · ${
              check.daysLeft >= 0
                ? `${check.daysLeft} day${check.daysLeft === 1 ? "" : "s"} to month-end`
                : "month-end has passed"
            }`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!check.valid || check.ready + check.blocked === 0}
        onClick={() => setOpen(true)}
      >
        See what is missing
      </Button>
      {open && check.valid && (
        <ReportDialog
          title={`Invoices for ${check.month}`}
          subject={`Invoice readiness: ${check.month}`}
          text={check.text}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
