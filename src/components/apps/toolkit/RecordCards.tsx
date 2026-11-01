"use client";

import { recordAlert, type AlertContext } from "@/lib/registers/alerts";
import { cellText } from "@/lib/registers/cells";
import { isOpen, recordTitle } from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { AlertChip } from "./RecordDialog";
import { RecordActions, RecordCell } from "./RecordParts";

/** The card view of a register: the same cells and actions as the table, one card per record. */
export function RecordCards({
  def,
  records,
  ctx,
  onEdit,
  onDelete,
  onStamp,
}: {
  def: RegisterDef;
  records: readonly RegisterRecord[];
  ctx: AlertContext;
  onEdit: (record: RegisterRecord) => void;
  onDelete: (record: RegisterRecord) => void;
  onStamp: (record: RegisterRecord) => void;
}) {
  const [titleKey, ...rest] = def.columns;
  const titleField = def.fields.find((f) => f.key === titleKey);
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3"
      data-testid="register-cards"
    >
      {records.map((record) => {
        const alert = recordAlert(def, record, ctx);
        return (
          <li
            key={record.id}
            data-testid="register-card"
            className={`border-line bg-card rounded-card group flex flex-col gap-2 border px-4 py-3 ${isOpen(def, record) ? "" : "opacity-60"}`}
          >
            <button
              type="button"
              className="text-ink focus-ring text-left text-[14px] font-semibold underline-offset-2 hover:underline"
              onClick={() => onEdit(record)}
              aria-label={`Open ${recordTitle(def, record)}`}
            >
              {cellText(titleField, record.values[titleKey]) || recordTitle(def, record)}
            </button>
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
