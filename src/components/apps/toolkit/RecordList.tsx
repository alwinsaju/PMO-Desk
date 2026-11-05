"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { recordAlert, type AlertContext } from "@/lib/registers/alerts";
import { cellText } from "@/lib/registers/cells";
import { listColumns } from "@/lib/registers/layout";
import { isOpen, recordTitle } from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { handleRowKey, rowKeyAction } from "../rowNav";
import { isTypingTarget } from "../pmo-todo-app/listKeys";
import { AlertChip } from "./RecordDialog";
import { RecordCards } from "./RecordCards";
import { RecordActions, RecordCell } from "./RecordParts";
import { useWindowedRows } from "./useWindowedRows";

export interface RecordListHandle {
  /** Put focus on a record's name button, scrolling it into view first when a long list has not drawn it. */
  focusRecord: (id: string) => void;
}

/** Height of the sticky header row, so a row scrolled to the top is not hidden under it. */
const HEADER_PX = 38;
const HEADER_CELL =
  "border-line sticky top-0 z-10 border-b bg-surface bg-[image:linear-gradient(var(--color-win),var(--color-win))]";

/**
 * The records of one tool as a table or as cards. A long list (more than `WINDOW_THRESHOLD` rows) draws only the
 * rows on screen plus a few above and below, so 1,000 records open and scroll as fast as 30. Selection, J/K/Home/End/E
 * and focus return work on the whole list, not only on what is drawn.
 */
export function RecordList({
  def,
  records,
  ctx,
  view,
  scrollerRef,
  handle,
  selection,
  onOpen,
  onDelete,
  onStamp,
}: {
  def: RegisterDef;
  records: readonly RegisterRecord[];
  ctx: AlertContext;
  view: "table" | "cards";
  /** The box that scrolls (the list area of the tool). */
  scrollerRef: RefObject<HTMLElement | null>;
  handle: RefObject<RecordListHandle | null>;
  selection: {
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
    allSelected: boolean;
    onToggleAll: () => void;
  };
  onOpen: (record: RegisterRecord) => void;
  onDelete: (record: RegisterRecord) => void;
  onStamp: (record: RegisterRecord) => void;
}) {
  const columns = listColumns(def);
  const fieldOf = (key: string) => def.fields.find((f) => f.key === key);
  const contentRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const ids = records.map((r) => r.id);
  const win = useWindowedRows({
    ids,
    scrollerRef,
    contentRef,
    enabled: true,
    estimate: view === "table" ? 44 : 150,
    grid: view === "cards" ? { min: 260, gap: 12 } : undefined,
    header: view === "table" ? HEADER_PX : 0,
  });

  const focusIndex = (index: number) => {
    const find = () =>
      rootRef.current?.querySelector<HTMLElement>(
        `[data-record-index="${index}"] [data-record-open]`,
      ) ?? null;
    const el = find();
    if (el) {
      el.focus();
      return;
    }
    pendingFocus.current = index;
    win.scrollToItem(index);
  };

  // A row that was not drawn when it was asked for gets focus once the scroll has drawn it.
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-record-index="${index}"] [data-record-open]`,
    );
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  useImperativeHandle(handle, () => ({
    focusRecord: (id) => {
      const index = ids.indexOf(id);
      if (index >= 0) focusIndex(index);
    },
  }));

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!win.windowed) {
      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("[data-record-open]") ?? [],
      );
      const target = event.target as HTMLElement;
      const row = target.closest("tr, li");
      const current = row?.querySelector<HTMLElement>("[data-record-open]") ?? null;
      handleRowKey(event, items, current);
      return;
    }
    const target = event.target as HTMLElement;
    if (isTypingTarget(target)) return;
    const row = target.closest<HTMLElement>("[data-record-index]");
    const index = row ? Number(row.dataset.recordIndex) : -1;
    const action = rowKeyAction(event, index, records.length, { arrows: true });
    if (!action) return;
    if (action.type === "open") {
      const record = records[index];
      if (!record || !target.matches("[data-record-open]")) return;
      event.preventDefault();
      onOpen(record);
      return;
    }
    event.preventDefault();
    focusIndex(action.index);
  };

  const shownRecords = records.slice(win.from, win.to);

  if (view === "cards") {
    return (
      <div ref={rootRef} onKeyDown={handleKey}>
        <RecordCards
          def={def}
          records={shownRecords}
          startIndex={win.from}
          padTop={win.padTop}
          padBottom={win.padBottom}
          listRef={contentRef as RefObject<HTMLUListElement | null>}
          ctx={ctx}
          onEdit={onOpen}
          onDelete={onDelete}
          onStamp={onStamp}
          selection={selection}
        />
      </div>
    );
  }

  const span = columns.length + 3;
  return (
    <div ref={rootRef} onKeyDown={handleKey}>
      <table
        className={`w-full border-collapse text-left text-[13px] ${win.windowed ? "table-fixed" : ""}`}
        data-testid="register-table"
      >
        {win.windowed && (
          <colgroup>
            <col className="w-8" />
            {columns.map((key) => (
              <col key={key} />
            ))}
            <col className="w-48" />
            <col className="w-28" />
          </colgroup>
        )}
        <thead>
          <tr className="text-ink-muted text-[11.5px] font-bold tracking-[0.06em] uppercase">
            <th className={`${HEADER_CELL} w-8 px-2 py-2`}>
              <input
                type="checkbox"
                checked={selection.allSelected}
                onChange={selection.onToggleAll}
                aria-label="Select all shown"
              />
            </th>
            {columns.map((key) => (
              <th key={key} className={`${HEADER_CELL} px-2 py-2`}>
                {fieldOf(key)?.label}
              </th>
            ))}
            <th className={`${HEADER_CELL} px-2 py-2`}>Needs attention</th>
            <th className={`${HEADER_CELL} px-2 py-2`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody ref={contentRef as RefObject<HTMLTableSectionElement | null>}>
          {win.windowed && win.padTop > 0 && (
            <tr aria-hidden style={{ height: win.padTop }}>
              <td colSpan={span} className="p-0" />
            </tr>
          )}
          {shownRecords.map((record, offset) => {
            const alert = recordAlert(def, record, ctx);
            return (
              <tr
                key={record.id}
                data-testid="register-row"
                data-record-index={win.from + offset}
                data-record-id={record.id}
                data-measure-id={record.id}
                className={`border-line hover:bg-chip group border-b ${isOpen(def, record) ? "" : "opacity-60"}`}
              >
                <td className="px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={selection.selected.has(record.id)}
                    onChange={() => selection.onToggle(record.id)}
                    aria-label={`Select ${recordTitle(def, record)}`}
                  />
                </td>
                {columns.map((key, index) => (
                  <td key={key} className="px-2 py-2 align-top">
                    {index === 0 ? (
                      <button
                        type="button"
                        data-record-open
                        className="text-ink scroll-mt-12 text-left font-semibold [overflow-wrap:anywhere] underline-offset-2 hover:underline"
                        onClick={() => onOpen(record)}
                        aria-label={`Open ${recordTitle(def, record)}`}
                      >
                        {cellText(fieldOf(key), record.values[key], ctx.today) ||
                          recordTitle(def, record)}
                      </button>
                    ) : (
                      <RecordCell def={def} record={record} fieldKey={key} />
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 align-top">
                  {alert && <AlertChip level={alert.level} text={alert.text} />}
                </td>
                <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">
                  <RecordActions
                    def={def}
                    record={record}
                    onEdit={() => onOpen(record)}
                    onDelete={() => onDelete(record)}
                    onStamp={() => onStamp(record)}
                  />
                </td>
              </tr>
            );
          })}
          {win.windowed && win.padBottom > 0 && (
            <tr aria-hidden style={{ height: win.padBottom }}>
              <td colSpan={span} className="p-0" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
