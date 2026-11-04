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
import {
  bulkDelete,
  bulkRestore,
  deleteLines,
  deletedMessage,
  partialDeleteMessage,
  withTodoCount,
} from "@/lib/registers/bulkDelete";
import type { RegisterDef, RegisterRecord } from "@/lib/registers/types";
import type { RegisterState } from "./useRegister";

/**
 * One confirmation for deleting several records, listing every one. The delete is one
 * write (chunked for very large selections) and is followed by one Undo toast that puts
 * every deleted record back. Records hidden by a filter are never included.
 */
export function BulkDeleteDialog({
  def,
  records,
  state,
  onDeleted,
  onClose,
}: {
  def: RegisterDef;
  /** The records that will be deleted: ticked and on screen. */
  records: readonly RegisterRecord[];
  state: RegisterState;
  /** Called with the ids that are gone, so they can be unticked. */
  onDeleted: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = records.length;
  const withTodo = withTodoCount(records);

  const run = async () => {
    setBusy(true);
    setError(null);
    const toResult = (reply: { ok: boolean; reason?: string }) =>
      reply.ok
        ? { ok: true as const }
        : { ok: false as const, reason: reply.reason ?? "" };
    const result = await bulkDelete(records, {
      remove: async (ids) => toResult(await state.remove(ids)),
      save: async (back) => toResult(await state.save(back)),
    });
    setBusy(false);
    const { deleted, failed } = result;
    if (deleted.length > 0) {
      onDeleted(deleted.map((r) => r.id));
      toast({
        key: "undo-bulk-delete",
        tone: failed ? "danger" : undefined,
        message: failed
          ? partialDeleteMessage(deleted.length, count, failed)
          : deletedMessage(def, deleted),
        durationMs: 10_000,
        action: {
          label: "Undo",
          run: () =>
            void bulkRestore(deleted, {
              save: async (back) => toResult(await state.save(back)),
            }).then((back) => {
              if (!back.ok) {
                toast({
                  tone: "danger",
                  message: `${back.reason} ${back.restored} of ${deleted.length} put back.`,
                });
              }
            }),
        },
      });
      onClose();
      return;
    }
    if (failed) setError(failed);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>
          Delete {count} record{count === 1 ? "" : "s"}?
        </DialogTitle>
        <DialogDescription>
          These are removed from {def.title}. Undo in the message that follows puts every
          one of them back.
        </DialogDescription>
        <ul
          data-testid="bulk-delete-list"
          className="scroll-thin border-line rounded-control mt-3 max-h-64 list-disc overflow-y-auto border py-2 pr-3 pl-7 text-[13px]"
        >
          {deleteLines(def, records).map((line, index) => (
            <li key={records[index]!.id} className="text-ink py-0.5">
              {line}
            </li>
          ))}
        </ul>
        {withTodo > 0 && (
          <p className="text-ink-muted mt-2 text-[12.5px]">
            {withTodo} of these {withTodo === 1 ? "has a to-do" : "have to-dos"} in PMO
            To-Do. The to-dos stay where they are.
          </p>
        )}
        {error && (
          <p role="alert" className="text-red mt-2 text-[13px]">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="text-red"
            disabled={busy || count === 0}
            onClick={() => void run()}
          >
            {busy ? "Deleting…" : `Delete ${count} record${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
