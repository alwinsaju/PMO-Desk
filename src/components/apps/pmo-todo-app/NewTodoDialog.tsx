"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
} from "@/components/ui";
import { emptyDraft } from "@/lib/pmo/todoLogic";
import type { TodoDraft } from "@/lib/pmo/types";
import { createTodo } from "./api";
import { DraftForm } from "./DraftForm";

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
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogTitle>New to-do</DialogTitle>
        <DialogDescription>
          Create a to-do yourself; it does not come from a message.
        </DialogDescription>
        <ScrollArea className="mt-4 min-h-0 flex-1">
          <div className="pr-3">
            <DraftForm draft={draft} disabled={busy} onChange={setDraft} />
          </div>
        </ScrollArea>
        {error && (
          <p role="alert" className="text-ink mt-2 text-[12px] font-medium">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
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
