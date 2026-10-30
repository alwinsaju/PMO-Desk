"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { buildMailto } from "@/lib/pmo/chaser";
import { TextArea } from "../pmo-todo-app/parts";

/** Generated text to read, copy or open as an unsent mail. Nothing here sends anything. */
export function ReportDialog({
  title,
  description,
  subject,
  text,
  to,
  onClose,
}: {
  title: string;
  description?: string;
  subject: string;
  text: string;
  to?: string;
  onClose: () => void;
}) {
  const mail = buildMailto({ to, subject, body: text });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", message: "Copied." });
    } catch {
      toast({ tone: "danger", message: "Could not copy to the clipboard." });
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[680px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description ??
            "Read it, copy it or open it as a mail draft. Nothing is sent from here."}
        </DialogDescription>
        <TextArea
          readOnly
          rows={14}
          value={text}
          aria-label={title}
          data-testid="report-text"
          className="mt-3 font-mono text-[12.5px]"
        />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {!mail.ok && (
            <span className="text-ink-muted mr-auto text-[12px]">{mail.reason}</span>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={() => void copy()}>
            Copy
          </Button>
          {mail.ok && (
            <Button asChild>
              <a href={mail.url}>Open as unsent mail</a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
