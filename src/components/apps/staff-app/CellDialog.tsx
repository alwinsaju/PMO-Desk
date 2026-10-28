"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Switch,
} from "@/components/ui";
import { formatDate } from "@/lib/staff/dates";
import { CUSTOM_REF } from "@/lib/staff/rosterCatalog";
import { formatHours, parseTimeRange } from "@/lib/staff/shifts";
import type { ShiftAssignment } from "@/lib/staff/types";
import { Field } from "./parts";

export interface CellEdit {
  memberId: string;
  date: string;
  who: string;
  current: ShiftAssignment | null;
}

/** Custom hours, the swap flag and a note for one day. */
export function CellDialog({
  edit,
  onSave,
  onClose,
}: {
  edit: CellEdit | null;
  onSave: (next: { ref: string; text?: string; swap: boolean; note: string }) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={edit !== null} onOpenChange={(open) => !open && onClose()}>
      {edit && (
        <DialogContent className="max-w-md">
          <Form
            key={`${edit.memberId}|${edit.date}`}
            edit={edit}
            onSave={onSave}
            onClose={onClose}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Form({
  edit,
  onSave,
  onClose,
}: {
  edit: CellEdit;
  onSave: (next: { ref: string; text?: string; swap: boolean; note: string }) => void;
  onClose: () => void;
}) {
  const current = edit.current;
  const [text, setText] = useState(
    current?.ref === CUSTOM_REF ? (current.text ?? "") : "",
  );
  const [swap, setSwap] = useState(current?.swap === true);
  const [note, setNote] = useState(current?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const range = parseTimeRange(text);
  const keepsShift = !!current && current.ref !== CUSTOM_REF;

  function save() {
    const typed = text.trim();
    if (!typed && !keepsShift) {
      return setError("Type the hours, or pick a shift from the menu first.");
    }
    onSave(
      typed
        ? { ref: CUSTOM_REF, text: typed, swap, note: note.trim() }
        : { ref: current!.ref, swap, note: note.trim() },
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogTitle>Hours and notes</DialogTitle>
      <DialogDescription>
        {edit.who} · {formatDate(edit.date)}
      </DialogDescription>
      <div className="mt-5 flex flex-col gap-4">
        <Field
          label="Custom hours"
          htmlFor="cell-hours"
          hint={
            range
              ? `Read as ${formatHours(range.start, range.end)}.`
              : keepsShift
                ? "Leave empty to keep the shift on this day."
                : "For example 11AM-8PM or 6:00PM-3:00AM."
          }
        >
          <Input
            id="cell-hours"
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="11AM-8PM"
            maxLength={80}
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="cell-swap" className="text-ink-soft text-[13px] font-semibold">
            Swapped shift
          </label>
          <Switch id="cell-swap" checked={swap} onCheckedChange={setSwap} />
        </div>
        <Field label="Note" htmlFor="cell-note">
          <Input
            id="cell-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            maxLength={300}
          />
        </Field>
        {error && (
          <p role="alert" className="text-red text-[13px]">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
