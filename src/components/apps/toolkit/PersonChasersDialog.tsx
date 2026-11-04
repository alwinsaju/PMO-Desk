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
import type { PersonChaser } from "@/lib/registers/timesheets";

/** One timesheet chaser per person, each to copy or open as an unsent mail. Nothing here sends anything. */
export function PersonChasersDialog({
  chasers,
  onClose,
}: {
  chasers: PersonChaser[];
  onClose: () => void;
}) {
  const copy = async (text: string) => {
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
        <DialogTitle>Chasers, one per person</DialogTitle>
        <DialogDescription>
          Each draft is for one person. Copy it or open it as an unsent mail you can edit
          first. Nothing is sent from here.
        </DialogDescription>
        <ul
          className="scroll-thin mt-3 max-h-[60vh] space-y-2 overflow-auto"
          data-testid="person-chasers"
        >
          {chasers.map((c) => {
            const mail = buildMailto({ to: c.email, subject: c.subject, body: c.body });
            return (
              <li
                key={c.person}
                data-testid="person-chaser"
                className="border-line rounded-md border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink text-[13px] font-semibold">{c.person}</span>
                  <span className="text-ink-muted text-[12.5px]">
                    {c.email || "no email on file"}
                  </span>
                  <span className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Copy the chaser for ${c.person}`}
                    onClick={() => void copy(c.body)}
                  >
                    Copy
                  </Button>
                  {mail.ok ? (
                    <Button size="sm" asChild>
                      <a
                        href={mail.url}
                        aria-label={`Open the chaser for ${c.person} as unsent mail`}
                      >
                        Open as unsent mail
                      </a>
                    </Button>
                  ) : (
                    <span className="text-ink-muted text-[12px]">{mail.reason}</span>
                  )}
                </div>
                <p className="text-ink-soft mt-1 text-[12.5px] whitespace-pre-line">
                  {c.body}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
