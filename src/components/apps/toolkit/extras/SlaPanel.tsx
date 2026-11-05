"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { recordAlert, slaDue } from "@/lib/registers/alerts";
import { configProblem, isOpen, textOf } from "@/lib/registers/records";
import { parseSlaRows, skippedText } from "@/lib/registers/slaImport";
import { formatDayMonth } from "@/lib/staff/dates";
import { TextArea } from "../../pmo-todo-app/parts";
import type { PanelProps } from "../RegisterApp";

const PRIORITIES = ["p1", "p2", "p3", "p4"] as const;
const IMPORT_BATCH = 500;

/** SLA days by priority, and a paste box for incidents (Number, Priority, Opened[, Title]). */
export function SlaPanel({ def, state, today }: PanelProps) {
  const [days, setDays] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const current = (key: string) => String(days[key] ?? state.config[key] ?? "");
  const ctx = { today, config: state.config };
  // The same rule as the list's red chips and the tile: an open item with a Breached alert.
  const breached = state.items.filter(
    (i) => isOpen(def, i) && recordAlert(def, i, ctx)?.level === "late",
  ).length;
  const open = state.items.filter((i) => isOpen(def, i));

  const saveDays = async () => {
    const next = Object.fromEntries(
      PRIORITIES.map(
        (k) => [k, current(k).trim() === "" ? "" : Number(current(k))] as const,
      ),
    );
    const problem = configProblem(def, next);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }
    setBusy(true);
    const reply = await state.saveConfig(next);
    setBusy(false);
    if (reply.ok) setDays({});
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
    // The server takes at most 500 records at a time, so a long paste goes in batches.
    let added = 0;
    for (let start = 0; start < fresh.length; start += IMPORT_BATCH) {
      const batch = fresh.slice(start, start + IMPORT_BATCH);
      const reply = await state.save(
        batch.map((r) => ({
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
      if (!reply.ok) {
        setBusy(false);
        setMessage({
          tone: "error",
          text:
            added > 0
              ? `Added ${added} of ${fresh.length}, then stopped: ${reply.reason}`
              : reply.reason,
        });
        return;
      }
      added += batch.length;
    }
    setBusy(false);
    setPaste("");
    setMessage({
      tone: "ok",
      text: `Added ${added} item${added === 1 ? "" : "s"}${skippedText(parsed.skipped)}.`,
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
              min={1}
              max={365}
              step={1}
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
