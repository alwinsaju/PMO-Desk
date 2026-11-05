"use client";

import { recordAlert, type AlertContext } from "@/lib/registers/alerts";
import { cellText } from "@/lib/registers/cells";
import { isOpen, recordTitle } from "@/lib/registers/records";
import { listColumns } from "@/lib/registers/layout";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import type { RefObject } from "react";
import { AlertChip } from "./RecordDialog";
import { RecordActions, RecordCell } from "./RecordParts";

/** The card view of a register: the same cells and actions as the table, one card per record. A long list is
 *  drawn in part: `records` is then the slice on screen, `startIndex` its place in the whole list and the
 *  padding stands in for the cards above and below. */
export function RecordCards({
  def,
  records,
  ctx,
  onEdit,
  onDelete,
  onStamp,
  selection,
  startIndex = 0,
  padTop = 0,
  padBottom = 0,
  listRef,
}: {
  def: RegisterDef;
  records: readonly RegisterRecord[];
  ctx: AlertContext;
  onEdit: (record: RegisterRecord) => void;
  onDelete: (record: RegisterRecord) => void;
  onStamp: (record: RegisterRecord) => void;
  /** Tick boxes on the cards (bulk to-dos and delete); without it the cards have none. */
  selection?: { selected: ReadonlySet<string>; onToggle: (id: string) => void };
  startIndex?: number;
  padTop?: number;
  padBottom?: number;
  listRef?: RefObject<HTMLUListElement | null>;
}) {
  const [titleKey, ...rest] = listColumns(def);
  const titleField = def.fields.find((f) => f.key === titleKey);
  return (
    <ul
      ref={listRef}
      style={
        padTop || padBottom ? { paddingTop: padTop, paddingBottom: padBottom } : undefined
      }
      className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3"
      data-testid="register-cards"
    >
      {records.map((record, offset) => {
        const alert = recordAlert(def, record, ctx);
        return (
          <li
            key={record.id}
            data-testid="register-card"
            data-record-index={startIndex + offset}
            data-record-id={record.id}
            data-measure-id={record.id}
            className={`border-line bg-card rounded-card group flex flex-col gap-2 border px-4 py-3 ${isOpen(def, record) ? "" : "opacity-60"}`}
          >
            <div className="flex items-start gap-2">
              {selection && (
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={selection.selected.has(record.id)}
                  onChange={() => selection.onToggle(record.id)}
                  aria-label={`Select ${recordTitle(def, record)}`}
                />
              )}
              <button
                type="button"
                data-record-open
                className="text-ink focus-ring scroll-mt-4 text-left text-[14px] font-semibold [overflow-wrap:anywhere] underline-offset-2 hover:underline"
                onClick={() => onEdit(record)}
                aria-label={`Open ${recordTitle(def, record)}`}
              >
                {cellText(titleField, record.values[titleKey], ctx.today) ||
                  recordTitle(def, record)}
              </button>
            </div>
            {alert && (
              <span>
                <AlertChip level={alert.level} text={alert.text} />
              </span>
            )}
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
              {rest.map((key) => (
                <div key={key} className="col-span-2 grid grid-cols-subgrid items-center">
                  <dt className="text-ink-muted text-[12px]">
                    {def.fields.find((f) => f.key === key)?.label}
                  </dt>
                  <dd className="text-ink min-w-0">
                    <RecordCell def={def} record={record} fieldKey={key} />
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto flex items-center justify-end pt-1">
              <RecordActions
                def={def}
                record={record}
                onEdit={() => onEdit(record)}
                onDelete={() => onDelete(record)}
                onStamp={() => onStamp(record)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
