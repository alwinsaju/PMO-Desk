"use client";

import { useId } from "react";
import { Input } from "@/components/ui";
import type { FieldDef, FieldValue } from "@/lib/registers/types";
import { Field, NativeSelect, TextArea } from "../pmo-todo-app/parts";

/** One field of a record, drawn for its type. People are suggested from the Staff directory. */
export function FieldInput({
  field,
  value,
  onChange,
  people,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  people: readonly string[];
}) {
  const listId = useId();
  const text =
    typeof value === "string" ? value : value === undefined ? "" : String(value);
  const label = field.required ? `${field.label} *` : field.label;

  if (field.type === "longtext") {
    return (
      <Field label={label} className="col-span-2">
        <TextArea
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
          placeholder={field.placeholder}
        />
      </Field>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={label}>
        <NativeSelect
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        >
          {!field.required && <option value="">—</option>}
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </NativeSelect>
      </Field>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="text-ink-soft flex items-center gap-2 self-end pb-2 text-[13px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={field.label}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "tags") {
    const tags = Array.isArray(value) ? value.join(", ") : text;
    return (
      <Field label={label}>
        <Input
          value={tags}
          onChange={(e) => onChange(e.target.value.split(",").map((t) => t.trimStart()))}
          aria-label={field.label}
          placeholder="Separate with commas"
        />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <Input
        type={
          field.type === "date" ? "date" : field.type === "number" ? "number" : "text"
        }
        value={text}
        onChange={(e) =>
          onChange(
            field.type === "number" && e.target.value !== ""
              ? Number(e.target.value)
              : e.target.value,
          )
        }
        aria-label={field.label}
        placeholder={field.placeholder}
        list={field.type === "person" ? listId : undefined}
      />
      {field.type === "person" && (
        <datalist id={listId}>
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </Field>
  );
}
