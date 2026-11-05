"use client";

import { useId } from "react";
import { FormField, Input } from "@/components/ui";
import { fieldLimit, lengthHint } from "@/lib/registers/limits";
import type { FieldDef, FieldValue } from "@/lib/registers/types";
import { NativeSelect, TextArea } from "../pmo-todo-app/parts";

/** One field of a record, drawn for its type. People are suggested from the Staff directory, project names from the status-report register.
 *  A field's problem shows under it once it has been left, or at once after a Save attempt. */
export function FieldInput({
  field,
  value,
  onChange,
  people,
  projects = [],
  error,
  showErrorNow,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  people: readonly string[];
  /** Project names suggested for a field with `suggest: "projects"`. */
  projects?: readonly string[];
  error?: string;
  showErrorNow?: boolean;
}) {
  const listId = useId();
  const text =
    typeof value === "string" ? value : value === undefined ? "" : String(value);
  const label = (
    <>
      {field.label}
      {field.required && (
        <span aria-hidden className="text-red">
          {" *"}
        </span>
      )}
    </>
  );
  const frame = {
    label,
    error,
    showErrorNow,
    hint: lengthHint(text.trim().length, fieldLimit(field)),
  };
  // A suggestion list is only a hint: the box still takes any text.
  const suggestions =
    field.type === "person" ? people : field.suggest === "projects" ? projects : null;

  if (field.type === "longtext") {
    return (
      <FormField {...frame} className="col-span-2">
        {(control) => (
          <TextArea
            {...control}
            rows={4}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        )}
      </FormField>
    );
  }
  if (field.type === "select") {
    return (
      <FormField {...frame}>
        {(control) => (
          <NativeSelect
            {...control}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          >
            {!field.required && <option value="">—</option>}
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="text-ink-soft flex items-center gap-2 self-end pb-2 text-[13px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "tags") {
    const tags = Array.isArray(value) ? value.join(", ") : text;
    return (
      <FormField {...frame}>
        {(control) => (
          <Input
            {...control}
            value={tags}
            onChange={(e) =>
              onChange(e.target.value.split(",").map((t) => t.trimStart()))
            }
            placeholder="Separate with commas"
          />
        )}
      </FormField>
    );
  }
  return (
    <FormField {...frame}>
      {(control) => (
        <>
          <Input
            {...control}
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
            placeholder={field.placeholder}
            list={suggestions ? listId : undefined}
          />
          {suggestions && (
            <datalist id={listId}>
              {suggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
        </>
      )}
    </FormField>
  );
}
