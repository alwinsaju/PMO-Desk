"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import type { TodoDraft } from "@/lib/pmo/types";
import { createTodo } from "./api";
import { DraftForm } from "./DraftForm";
import { ErrorLine, ScrollBody } from "./parts";

interface NewTodoDialogProps {
  open: boolean;
  onSettled: () => void;
  onOpenChange: (open: boolean) => void;
}

/** A to-do typed in by hand (you are the reviewer, so it is created at once). */
export function NewTodoDialog({ open, onSettled, onOpenChange }: NewTodoDialogProps) {
  const [draft, setDraft] = useState<TodoDraft>(() => ({
    ...emptyDraft(),
    owner: { name: null, email: null, isMe: true },
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const reply = await createTodo(draft);
      if (!reply.ok) return setError(reply.reason);
      setDraft({ ...emptyDraft(), owner: { name: null, email: null, isMe: true } });
      onSettled();
      onOpenChange(false);
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-full max-w-xl flex-col px-[30px] pt-7 pb-6">
        <DialogTitle className="shrink-0">New to-do</DialogTitle>
        <DialogDescription className="shrink-0">
          Create a to-do yourself; it does not come from a message.
        </DialogDescription>
        <ScrollBody className="mt-4 pr-2">
          <DraftForm draft={draft} disabled={busy} onChange={setDraft} />
        </ScrollBody>
        {error && <ErrorLine className="mt-3 shrink-0">{error}</ErrorLine>}
        <div className="border-line mt-4 flex shrink-0 justify-end gap-2.5 border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !draft.title.trim()} onClick={() => void create()}>
            Create to-do
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
