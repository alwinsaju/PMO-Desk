"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SquaresFourIcon, TableIcon } from "@phosphor-icons/react";
import { Button, EmptyState, IconButton, Input } from "@/components/ui";
import { InvalidRecords } from "./InvalidRecords";
import { RecordList, type RecordListHandle } from "./RecordList";
import { UnreadableTool } from "./UnreadableTool";
import { toolApps } from "@/components/taskbar/pinnedApps";
import { toast } from "@/lib/notifications/toastStore";
import { summarise } from "@/lib/registers/alerts";
import { canBulkTodos, lateWithoutTodo, splitSelection } from "@/lib/registers/bulkTodos";
import { exportHint } from "@/lib/registers/cells";
import { registerById } from "@/lib/registers/defs";
import {
  csvRows,
  filterRecords,
  sortRecords,
  statusCounts,
} from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";
import { toCsv } from "@/lib/staff/exportFiles";
import {
  allSelected,
  selectedText,
  selectionView,
  toggleAll,
  toggleId,
  withoutIds,
} from "@/lib/ui/multiSelect";
import { noSpellcheck } from "@/lib/ui/noSpellcheck";
import { NativeSelect } from "../pmo-todo-app/parts";
import { readSetting, writeSetting } from "../staff-app/localSetting";
import { HeatMap, type HeatSelection } from "./HeatMap";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { BulkTodoDialog } from "./BulkTodoDialog";
import { RecordDialog, type ExtrasContext, type Values } from "./RecordDialog";
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
  startAdding = false,
}: {
  defId: string;
  windowId: string;
  /** Open the new-record dialog on first render only (a Toolkit tile's plus button). It is
   *  the initial value of the dialog state, so a re-render never opens it again and closing
   *  it leaves the tool open. */
  startAdding?: boolean;
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
  const [editing, setEditing] = useState<RegisterRecord | "new" | null>(
    startAdding ? "new" : null,
  );
  const [heat, setHeat] = useState<HeatSelection | null>(null);
  /** The values of a record being duplicated: opens an unsaved new record with them. */
  const [copyOf, setCopyOf] = useState<Values | null>(null);
  /** A saved record that fails the checks, open in the form to be fixed. */
  const [repairing, setRepairing] = useState<RegisterRecord | null>(null);
  /** Where focus was when a dialog opened, so it goes back there when the dialog closes. In a long list the
   *  row may not be drawn any more, so its record id is kept too. */
  const openerRef = useRef<{ el: HTMLElement | null; id: string | null }>({
    el: null,
    id: null,
  });
  const openDialog = (target: RegisterRecord | "new") => {
    const el = document.activeElement as HTMLElement | null;
    openerRef.current = {
      el,
      id: target === "new" ? null : target.id,
    };
    setEditing(target);
  };
  const closeDialog = () => {
    setEditing(null);
    setCopyOf(null);
    setRepairing(null);
    requestAnimationFrame(() => {
      const { el, id } = openerRef.current;
      if (el?.isConnected) el.focus();
      else if (id) listHandle.current?.focusRecord(id);
    });
  };
  /** Ticked records (every tool has the boxes) and the open confirmations. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingTodos, setConfirmingTodos] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [view, setView] = useState<"table" | "cards">("table");
  useEffect(() => {
    if (readSetting(`register-view:${defId}`) === "cards") setView("cards");
  }, [defId]);
  const chooseView = (next: "table" | "cards") => {
    setView(next);
    writeSetting(`register-view:${defId}`, next);
  };

  const ctx = useMemo(() => ({ today, config: state.config }), [today, state.config]);
  const shown = useMemo(
    () =>
      sortRecords(
        def,
        filterRecords(def, state.items, {
          query,
          status: status || undefined,
          includeClosed: showClosed,
          match:
            heat && def.heat
              ? { [def.heat.rows]: heat.row, [def.heat.cols]: heat.col }
              : undefined,
        }),
      ),
    [def, state.items, query, status, showClosed, heat],
  );
  const summary = useMemo(
    () => summarise(def, state.items, ctx),
    [def, state.items, ctx],
  );
  const counts = useMemo(() => statusCounts(def, state.items), [def, state.items]);
  const bulkTodos = canBulkTodos(def);
  const lateShown = useMemo(
    () => (bulkTodos ? lateWithoutTodo(def, shown, ctx) : []),
    [bulkTodos, def, shown, ctx],
  );
  // A bulk action only reaches ticked records that are on screen. Records that no longer exist
  // (a refresh or a delete can remove a ticked one) are not counted.
  const sel = useMemo(
    () =>
      selectionView(
        shown,
        state.items.map((r) => r.id),
        selected,
      ),
    [shown, state.items, selected],
  );
  const split = useMemo(
    () => splitSelection(def, sel.visible, selected),
    [def, sel.visible, selected],
  );
  const selectedCount = sel.visible.length;
  const toggleSelected = (id: string) => setSelected((cur) => toggleId(cur, id));
  const shownIds = useMemo(() => shown.map((r) => r.id), [shown]);
  const allShownSelected = allSelected(selected, shownIds);
  const toggleAllShown = () => setSelected((cur) => toggleAll(cur, shownIds));
  const ToolGlyph = toolApps.find((tool) => tool.id === def.id)?.icon;
  const noExport = exportHint(state.items.length, shown.length);
  const exportHintId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const listHandle = useRef<RecordListHandle | null>(null);
  const removeRecord = async (record: RegisterRecord) => {
    const reply = await removeWithUndo(def, state, record);
    if (!reply.ok) toast({ tone: "danger", message: reply.reason });
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

  if (!state.loaded && state.error) {
    return (
      <div
        data-window-id={windowId}
        data-testid={`tool-${def.id}`}
        className="flex h-full w-full flex-col"
      >
        <UnreadableTool
          title={def.title}
          blurb={def.blurb}
          error={state.error}
          onRetry={state.reload}
        />
      </div>
    );
  }

  return (
    <div
      data-window-id={windowId}
      data-testid={`tool-${def.id}`}
      className="scroll-thin flex h-full w-full flex-col overflow-y-auto"
    >
      <div className="flex flex-wrap items-center gap-2 px-6 pt-1 pb-2">
        <div className="min-w-48 flex-1">
          <p className="text-ink-muted text-[13px]">{def.blurb}</p>
          <p className="text-ink-soft mt-1 text-[12.5px]" data-testid="register-summary">
            {def.statusKey ? `${summary.open} open` : `${summary.total} in all`}
            {summary.late > 0 && (
              <span className="text-red font-semibold"> · {summary.late} late</span>
            )}
            {summary.soon > 0 && (
              <span className="text-amber font-semibold"> · {summary.soon} soon</span>
            )}
            {def.statusKey && ` · ${summary.total} in all`}
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog("new")}>
          Add {def.noun}
        </Button>
      </div>

      <InvalidRecords def={def} state={state} onRepair={setRepairing} />
      {def.extras === "sla" && <SlaPanel {...panelProps} />}
      {def.extras === "changes" && <ChangesPanel {...panelProps} />}
      {def.extras === "invoice" && <InvoicePanel {...panelProps} />}
      {def.extras === "status-report" && <StatusReportPanel {...panelProps} />}
      {renderTop?.({ ...panelProps, leave })}
      {state.loaded && state.items.length > 0 && (
        <HeatMap def={def} items={state.items} selected={heat} onSelect={setHeat} />
      )}

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
        <div role="group" aria-label="View" className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            aria-label="Table view"
            aria-pressed={view === "table"}
            variant={view === "table" ? "secondary" : "ghost"}
            onClick={() => chooseView("table")}
          >
            <TableIcon />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Card view"
            aria-pressed={view === "cards"}
            variant={view === "cards" ? "secondary" : "ghost"}
            onClick={() => chooseView("cards")}
          >
            <SquaresFourIcon />
          </IconButton>
        </div>
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

      {(lateShown.length > 0 || selectedCount > 0 || sel.hidden > 0) && (
        <div
          data-testid="bulk-bar"
          className="flex flex-wrap items-center gap-2 px-6 pb-2 text-[12.5px]"
        >
          {lateShown.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSelected((cur) => new Set([...cur, ...lateShown.map((r) => r.id)]))
              }
            >
              Select {lateShown.length} late without a to-do
            </Button>
          )}
          {(selectedCount > 0 || sel.hidden > 0) && (
            <>
              <span className="text-ink-soft" aria-live="polite">
                {selectedText(selectedCount, sel.hidden)}
              </span>
              {!allShownSelected && (
                <Button variant="ghost" size="sm" onClick={toggleAllShown}>
                  Select all {shown.length} shown
                </Button>
              )}
              {bulkTodos && (
                <Button
                  size="sm"
                  disabled={split.eligible.length === 0}
                  onClick={() => setConfirmingTodos(true)}
                >
                  Make {split.eligible.length} to-do
                  {split.eligible.length === 1 ? "" : "s"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-red"
                disabled={selectedCount === 0}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete {selectedCount}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </>
          )}
        </div>
      )}

      <div ref={listRef} className="scroll-thin min-h-56 flex-1 overflow-auto px-6 pb-6">
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
              <Button size="sm" onClick={() => openDialog("new")}>
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
            No record matches. Clear the search
            {heat ? ", the heat-map cell" : ""} or show closed ones.
            {heat && (
              <Button variant="ghost" size="sm" onClick={() => setHeat(null)}>
                Clear heat-map filter
              </Button>
            )}
          </p>
        )}
        {shown.length > 0 && (
          <RecordList
            def={def}
            records={shown}
            ctx={ctx}
            view={view}
            scrollerRef={listRef}
            handle={listHandle}
            selection={{
              selected,
              onToggle: toggleSelected,
              allSelected: allShownSelected,
              onToggleAll: toggleAllShown,
            }}
            onOpen={openDialog}
            onDelete={(record) => void removeRecord(record)}
            onStamp={(record) => void stamp(record)}
          />
        )}
      </div>

      {editing && (
        <RecordDialog
          def={def}
          record={editing === "new" ? null : editing}
          state={state}
          people={people}
          names={names}
          onClose={closeDialog}
          renderExtras={renderExtras}
          onDuplicate={(values) => {
            setEditing(null);
            setCopyOf(values);
          }}
        />
      )}
      {copyOf && (
        <RecordDialog
          def={def}
          record={null}
          initialValues={copyOf}
          state={state}
          people={people}
          names={names}
          onClose={closeDialog}
          renderExtras={renderExtras}
        />
      )}
      {repairing && (
        <RecordDialog
          def={def}
          record={repairing}
          repair
          state={state}
          people={people}
          names={names}
          onClose={closeDialog}
        />
      )}
      {confirmingTodos && (
        <BulkTodoDialog
          def={def}
          records={split.eligible}
          skipped={split.skipped}
          state={state}
          people={people}
          onMade={(ids) => setSelected((cur) => withoutIds(cur, ids))}
          onClose={() => setConfirmingTodos(false)}
        />
      )}
      {confirmingDelete && (
        <BulkDeleteDialog
          def={def}
          records={sel.visible}
          state={state}
          onDeleted={(ids) => setSelected((cur) => withoutIds(cur, ids))}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
