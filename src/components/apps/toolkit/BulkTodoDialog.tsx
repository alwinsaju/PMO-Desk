"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { confirmLine, makeTodosFor } from "@/lib/registers/bulkTodos";
import type { Person } from "@/lib/registers/timesheets";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import { createTodoFrom } from "./todoBridge";
import type { RegisterState } from "./useRegister";

/**
 * One confirmation for "make to-dos" on several records. It lists every record, because making
 * a to-do posts a real to-do in PMO To-Do straight away (there is no proposal to review). The
 * to-do id is saved on each record as it is made, so none is made twice.
 */
export function BulkTodoDialog({
  def,
  records,
  skipped,
  state,
  people,
  onMade,
  onClose,
}: {
  def: RegisterDef;
  /** The records to-dos will be made from (open, none made yet). */
  records: readonly RegisterRecord[];
  /** How many chosen records are left out (closed, or a to-do already made). */
  skipped: number;
  state: RegisterState;
  people: readonly Person[];
  /** Called with the ids of the records that got a to-do. */
  onMade: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = records.length;

  const run = async () => {
    setBusy(true);
    setError(null);
    const result = await makeTodosFor(def, records, {
      make: (seed) => createTodoFrom(seed, people),
      link: async (record, todoId) => {
        const reply = await state.save([
          { id: record.id, values: record.values, todoId },
        ]);
        return reply.ok ? { ok: true } : { ok: false, reason: reply.reason };
      },
    });
    setBusy(false);
    onMade(result.made.map((m) => m.record.id));
    const n = result.made.length;
    if (result.stopped) {
      const { todoMade } = result.stopped;
      const notMade = todoMade ? result.notDone : result.notDone + 1;
      setError(
        `${result.stopped.reason} ${n} made, ${notMade} not made.${
          todoMade
            ? " One more to-do was made but could not be linked to its record: check PMO To-Do before trying again."
            : ""
        }`,
      );
      if (n > 0)
        toast({ tone: "success", message: `Made ${n} to-do${n === 1 ? "" : "s"}.` });
      return;
    }
    toast({
      tone: "success",
      message: `Made ${n} to-do${n === 1 ? "" : "s"} in PMO To-Do.`,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>
          Make {count} to-do{count === 1 ? "" : "s"}?
        </DialogTitle>
        <DialogDescription>
          These are added to PMO To-Do straight away, one for each item below, and each{" "}
          {def.noun} is marked so it is not made twice.
        </DialogDescription>
        <ul
          data-testid="bulk-todo-list"
          className="scroll-thin border-line rounded-control mt-3 max-h-64 list-disc overflow-y-auto border py-2 pr-3 pl-7 text-[13px]"
        >
          {records.map((record) => (
            <li key={record.id} className="text-ink py-0.5">
              {confirmLine(def, record)}
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="text-ink-muted mt-2 text-[12.5px]">
            {skipped} chosen {skipped === 1 ? "item is" : "items are"} left out: closed or
            already has a to-do.
          </p>
        )}
        {error && (
          <p role="alert" className="text-red mt-2 text-[13px]">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || count === 0} onClick={() => void run()}>
            {busy ? "Making…" : `Make ${count} to-do${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
