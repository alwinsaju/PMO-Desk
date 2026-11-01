"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { Badge, Button, EmptyState, IconButton, Input } from "@/components/ui";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { toast } from "@/lib/notifications/toastStore";
import { recordAlert, summarise } from "@/lib/registers/alerts";
import { cellText, exportHint, statusTone } from "@/lib/registers/cells";
import { registerById } from "@/lib/registers/defs";
import {
  csvRows,
  filterRecords,
  isOpen,
  recordTitle,
  sortRecords,
  statusCounts,
  textOf,
} from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";
import { toCsv } from "@/lib/staff/exportFiles";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { NativeSelect } from "../pmo-todo-app/parts";
import { AlertChip, RecordDialog, type ExtrasContext } from "./RecordDialog";
import { ChangesPanel } from "./extras/ChangesPanel";
import { GovernanceExtras } from "./extras/GovernanceExtras";
import { InvoicePanel } from "./extras/InvoicePanel";
import { MinutesExtras } from "./extras/MinutesExtras";
import { SlaPanel } from "./extras/SlaPanel";
import { StatusReportPanel } from "./extras/StatusReportPanel";
import { removeWithUndo } from "./removeWithUndo";
import { usePeople } from "./usePeople";
import { useRegister, type RegisterState } from "./useRegister";

export interface PanelProps {
  def: RegisterDef;
  state: RegisterState;
  today: string;
  people: ReturnType<typeof usePeople>["people"];
}

export interface TopProps extends PanelProps {
  leave: ReturnType<typeof usePeople>["leave"];
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** One PMO tool as a list: search, filter, add, edit, export, with the tool's alerts and extra panel. */
export function RegisterApp({
  defId,
  windowId,
  renderTop,
}: {
  defId: string;
  windowId: string;
  /** A panel for tools with their own view above the list (the capacity grid). */
  renderTop?: (props: TopProps) => ReactNode;
}) {
  const def = registerById(defId)!;
  const state = useRegister(def.id);
  const { people, names, leave } = usePeople();
  const today = todayIso();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<RegisterRecord | "new" | null>(null);

  const ctx = useMemo(() => ({ today, config: state.config }), [today, state.config]);
  const shown = useMemo(
    () =>
      sortRecords(
        def,
        filterRecords(def, state.items, {
          query,
          status: status || undefined,
          includeClosed: showClosed,
        }),
      ),
    [def, state.items, query, status, showClosed],
  );
  const summary = useMemo(
    () => summarise(def, state.items, ctx),
    [def, state.items, ctx],
  );
  const counts = useMemo(() => statusCounts(def, state.items), [def, state.items]);
  const fieldOf = (key: string) => def.fields.find((f) => f.key === key);
  const ToolGlyph = toolApps.find((tool) => tool.id === def.id)?.icon;
  const noExport = exportHint(state.items.length, shown.length);
  const exportHintId = useId();

  const removeRecord = async (record: RegisterRecord) => {
    const reply = await removeWithUndo(def, state, record);
    if (!reply.ok) toast({ tone: "danger", message: reply.reason });
  };

  const renderCell = (record: RegisterRecord, key: string) => {
    const text = cellText(fieldOf(key), record.values[key]);
    if (!text) {
      return (
        <>
          <span aria-hidden className="text-ink-faint">
            —
          </span>
          <span className="sr-only">Not set</span>
        </>
      );
    }
    if (key === def.statusKey) {
      return <Badge variant={statusTone(def, text)}>{text}</Badge>;
    }
    if (key === "url") {
      return (
        <a
          href={textOf(record, "url")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-info underline"
        >
          {text}
        </a>
      );
    }
    return text;
  };

  const stamp = async (record: RegisterRecord) => {
    if (!def.stamp) return;
    const reply = await state.save([
      {
        id: record.id,
        values: { ...record.values, [def.stamp.key]: today },
        todoId: record.todoId,
      },
    ]);
    if (!reply.ok) toast({ tone: "danger", message: reply.reason });
  };

  const exportCsv = () => {
    downloadText(`${def.id}.csv`, toCsv(csvRows(def, shown)));
    toast({ tone: "success", message: `Exported ${shown.length} rows as CSV.` });
  };

  const renderExtras = (extras: ExtrasContext): ReactNode => {
    if (def.extras === "minutes")
      return <MinutesExtras ctx={extras} state={state} people={people} />;
    if (def.extras === "governance")
      return <GovernanceExtras ctx={extras} state={state} people={people} />;
    return null;
  };
  const panelProps: PanelProps = { def, state, today, people };

  return (
    <div
      data-window-id={windowId}
      data-testid={`tool-${def.id}`}
      className="flex h-full w-full flex-col"
    >
      <div className="flex flex-wrap items-center gap-2 px-6 pt-1 pb-2">
        <div className="min-w-48 flex-1">
          <p className="text-ink-muted text-[13px]">{def.blurb}</p>
          <p className="text-ink-soft mt-1 text-[12.5px]" data-testid="register-summary">
            {summary.open} open
            {summary.late > 0 && (
              <span className="text-red font-semibold"> · {summary.late} late</span>
            )}
            {summary.soon > 0 && (
              <span className="text-amber font-semibold"> · {summary.soon} soon</span>
            )}
            {" · "}
            {summary.total} in all
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          Add {def.noun}
        </Button>
      </div>

      {def.extras === "sla" && <SlaPanel {...panelProps} />}
      {def.extras === "changes" && <ChangesPanel {...panelProps} />}
      {def.extras === "invoice" && <InvoicePanel {...panelProps} />}
      {def.extras === "status-report" && <StatusReportPanel {...panelProps} />}
      {renderTop?.({ ...panelProps, leave })}

      <div className="flex flex-wrap items-center gap-2 px-6 pb-2">
        <Input
          {...noSpellcheck}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${def.title}`}
          placeholder="Search"
          className="max-w-60"
        />
        {def.statusKey && (
          <NativeSelect
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="w-auto"
          >
            <option value="">All statuses</option>
            {counts.map((c) => (
              <option key={c.status} value={c.status}>
                {c.status} ({c.count})
              </option>
            ))}
          </NativeSelect>
        )}
        {def.statusKey && (
          <label className="text-ink-soft flex items-center gap-1.5 text-[12.5px]">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            Show closed
          </label>
        )}
        <span className="flex-1" />
        {noExport && (
          <span id={exportHintId} className="text-ink-muted text-[12px]">
            {noExport}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={shown.length === 0}
          aria-describedby={noExport ? exportHintId : undefined}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-6 pb-6">
        {state.error && (
          <p role="alert" className="text-red text-[13px]">
            {state.error.reason}
          </p>
        )}
        {state.loaded && state.items.length === 0 && (
          <EmptyState
            data-testid="register-empty"
            icon={ToolGlyph && <ToolGlyph size={22} />}
            headline={`No ${def.title} entries yet`}
            description={def.blurb}
            action={
              <Button size="sm" onClick={() => setEditing("new")}>
                Add your first {def.firstNoun ?? def.noun}
              </Button>
            }
          />
        )}
        {state.loaded && state.items.length > 0 && shown.length === 0 && (
          <p
            className="text-ink-muted py-6 text-center text-[13px]"
            data-testid="register-empty"
          >
            No record matches. Clear the search or show closed ones.
          </p>
        )}
        {shown.length > 0 && (
          <table
            className="w-full border-collapse text-left text-[13px]"
            data-testid="register-table"
          >
            <thead>
              <tr className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase">
                {def.columns.map((key) => (
                  <th key={key} className="border-line border-b px-2 py-2">
                    {fieldOf(key)?.label}
                  </th>
                ))}
                <th className="border-line border-b px-2 py-2">Needs attention</th>
                <th className="border-line border-b px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((record) => {
                const alert = recordAlert(def, record, ctx);
                return (
                  <tr
                    key={record.id}
                    data-testid="register-row"
                    className={`border-line hover:bg-chip group border-b ${isOpen(def, record) ? "" : "opacity-60"}`}
                  >
                    {def.columns.map((key, index) => (
                      <td key={key} className="px-2 py-2 align-top">
                        {index === 0 ? (
                          <button
                            type="button"
                            className="text-ink text-left font-semibold underline-offset-2 hover:underline"
                            onClick={() => setEditing(record)}
                            aria-label={`Open ${recordTitle(def, record)}`}
                          >
                            {cellText(fieldOf(key), record.values[key]) ||
                              recordTitle(def, record)}
                          </button>
                        ) : (
                          renderCell(record, key)
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2 align-top">
                      {alert && <AlertChip level={alert.level} text={alert.text} />}
                    </td>
                    <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">
                      {def.stamp && isOpen(def, record) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void stamp(record)}
                        >
                          {def.stamp.label}
                        </Button>
                      )}
                      {def.id === "doclinks" && (
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={textOf(record, "url")}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open link
                          </a>
                        </Button>
                      )}
                      <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                        <IconButton
                          size="sm"
                          aria-label={`Edit ${recordTitle(def, record)}`}
                          onClick={() => setEditing(record)}
                        >
                          <PencilSimpleIcon />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="destructive-quiet"
                          aria-label={`Delete ${recordTitle(def, record)}`}
                          onClick={() => void removeRecord(record)}
                        >
                          <TrashIcon />
                        </IconButton>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <RecordDialog
          def={def}
          record={editing === "new" ? null : editing}
          state={state}
          people={people}
          names={names}
          onClose={() => setEditing(null)}
          renderExtras={renderExtras}
        />
      )}
    </div>
  );
}
