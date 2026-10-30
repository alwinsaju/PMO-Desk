"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { slaDue } from "@/lib/registers/alerts";
import { isOpen, textOf } from "@/lib/registers/records";
import { parseSlaRows } from "@/lib/registers/slaImport";
import { formatDayMonth } from "@/lib/staff/dates";
import { TextArea } from "../../pmo-todo-app/parts";
import type { PanelProps } from "../RegisterApp";

const PRIORITIES = ["p1", "p2", "p3", "p4"] as const;

/** SLA days by priority, and a paste box for incidents (Number, Priority, Opened[, Title]). */
export function SlaPanel({ def, state, today }: PanelProps) {
  const [days, setDays] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const current = (key: string) => String(days[key] ?? state.config[key] ?? "");
  const open = state.items.filter((i) => isOpen(def, i));
  const breached = open.filter((i) => {
    const due = slaDue(i, state.config);
    return due !== "" && due < today;
  }).length;

  const saveDays = async () => {
    setBusy(true);
    const next = Object.fromEntries(
      PRIORITIES.map((k) => [k, Number(current(k))] as const),
    );
    const reply = await state.saveConfig(next);
    setBusy(false);
    setMessage(
      reply.ok
        ? { tone: "ok", text: "Saved. New SLA days apply to every item." }
        : { tone: "error", text: reply.reason },
    );
  };

  const importRows = async () => {
    const parsed = parseSlaRows(paste);
    const known = new Set(state.items.map((i) => textOf(i, "ref").toLowerCase()));
    const fresh = parsed.rows.filter((r) => !known.has(r.ref.toLowerCase()));
    if (fresh.length === 0) {
      setMessage({
        tone: parsed.rows.length > 0 ? "ok" : "error",
        text:
          parsed.rows.length > 0
            ? "Those are already in the list."
            : `Nothing to import. ${parsed.skipped[0]?.reason ?? "Paste lines like INC001, 2 - High, 2026-03-02."}`,
      });
      return;
    }
    setBusy(true);
    const reply = await state.save(
      fresh.map((r) => ({
        values: {
          ref: r.ref,
          title: r.title,
          priority: r.priority,
          received: r.received,
          status: "Open",
          resolvedOn: "",
          owner: "",
        },
      })),
    );
    setBusy(false);
    if (!reply.ok) {
      setMessage({ tone: "error", text: reply.reason });
      return;
    }
    setPaste("");
    setMessage({
      tone: "ok",
      text: `Added ${fresh.length} item${fresh.length === 1 ? "" : "s"}${parsed.skipped.length ? `; skipped ${parsed.skipped.length} (${parsed.skipped[0]!.reason})` : ""}.`,
    });
  };

  const nextDue = open
    .map((i) => slaDue(i, state.config))
    .filter((d) => d >= today)
    .sort()[0];

  return (
    <details
      className="border-line mx-6 mb-2 rounded-md border px-3 py-2"
      data-testid="sla-panel"
    >
      <summary className="text-ink-soft cursor-pointer text-[13px] font-semibold">
        SLA settings and import · {breached} breached
        {nextDue ? ` · next due ${formatDayMonth(nextDue)}` : ""}
      </summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {PRIORITIES.map((key) => (
          <label
            key={key}
            className="text-ink-soft flex flex-col gap-1 text-[12px] font-semibold"
          >
            {key.toUpperCase()} (days)
            <Input
              type="number"
              min={0}
              value={current(key)}
              onChange={(e) => setDays((d) => ({ ...d, [key]: e.target.value }))}
              aria-label={`${key.toUpperCase()} SLA days`}
              className="w-20"
            />
          </label>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void saveDays()}
        >
          Save SLA days
        </Button>
      </div>
      <div className="mt-3">
        <TextArea
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          aria-label="Paste incidents"
          placeholder={
            "Paste lines from a spreadsheet: Number, Priority, Opened, Title\nINC0012345, 2 - High, 02/03/2026, Printer down"
          }
        />
        <Button
          size="sm"
          className="mt-2"
          disabled={busy || paste.trim() === ""}
          onClick={() => void importRows()}
        >
          Import pasted incidents
        </Button>
      </div>
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-2 text-[12.5px] ${message.tone === "error" ? "text-red" : "text-ink-muted"}`}
        >
          {message.text}
        </p>
      )}
    </details>
  );
}
