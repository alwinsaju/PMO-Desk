"use client";

import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { Avatar, Badge, Button, IconButton } from "@/components/ui";
import { cellText } from "@/lib/registers/cells";
import { cellTone, personInitials } from "@/lib/registers/cellStyle";
import { isOpen, recordTitle, textOf } from "@/lib/registers/records";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { todayIso } from "@/lib/staff/dates";

/** One value of a record, shared by the table and the card view: RAG badge, type chip,
 *  owner with initials, link, or plain text. */
export function RecordCell({
  def,
  record,
  fieldKey,
}: {
  def: RegisterDef;
  record: RegisterRecord;
  fieldKey: string;
}) {
  const field = def.fields.find((f) => f.key === fieldKey);
  const text = cellText(field, record.values[fieldKey], todayIso());
  if (!text) {
    return (
      <>
        <span aria-hidden className="text-ink-faint">
          â€”
        </span>
        <span className="sr-only">Not set</span>
      </>
    );
  }
  if (field?.type === "person") {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5">
        <Avatar
          size="sm"
          className="h-6 w-6 shrink-0 text-[10px]"
          fallback={personInitials(text)}
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
      </span>
    );
  }
  if (fieldKey === "url") {
    return (
      <a
        href={textOf(record, "url")}
        target="_blank"
        rel="noopener noreferrer"
        title={textOf(record, "url")}
        className="text-info [overflow-wrap:anywhere] underline"
      >
        {text}
      </a>
    );
  }
  const tone = cellTone(def, fieldKey, text);
  return tone ? (
    <Badge variant={tone}>{text}</Badge>
  ) : (
    <span className="[overflow-wrap:anywhere]">{text}</span>
  );
}

/** The per-record actions: the tool's one-click stamp, the link, and Edit / Delete. */
export function RecordActions({
  def,
  record,
  onEdit,
  onDelete,
  onStamp,
}: {
  def: RegisterDef;
  record: RegisterRecord;
  onEdit: () => void;
  onDelete: () => void;
  onStamp: () => void;
}) {
  const title = recordTitle(def, record);
  return (
    <>
      {def.stamp && isOpen(def, record) && (
        <Button variant="ghost" size="sm" onClick={onStamp}>
          {def.stamp.label}
        </Button>
      )}
      {def.id === "doclinks" && (
        <Button variant="outline" size="sm" asChild>
          <a href={textOf(record, "url")} target="_blank" rel="noopener noreferrer">
            Open link
          </a>
        </Button>
      )}
      <span className="inline-flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        <IconButton size="sm" aria-label={`Edit ${title}`} onClick={onEdit}>
          <PencilSimpleIcon />
        </IconButton>
        <IconButton
          size="sm"
          variant="destructive-quiet"
          aria-label={`Delete ${title}`}
          onClick={onDelete}
        >
          <TrashIcon />
        </IconButton>
      </span>
    </>
  );
}
