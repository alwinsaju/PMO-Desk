"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { ScrollArea } from "@/components/ui";
import { displayText } from "@/lib/pmo/preprocess";
import { locateQuote } from "@/lib/pmo/quote";
import type { Intake } from "@/lib/pmo/types";
import { fetchRaw } from "./api";
import { SourceBadge } from "./parts";

interface OriginalMessageProps {
  intakeId: string;
  /** The model's quote; highlighted where it really occurs in the message. */
  quote?: string | null;
  className?: string;
}

/** Only a real Teams deep link becomes clickable; the link text comes from the message. */
function isTeamsLink(link: string | undefined): link is string {
  if (!link) return false;
  try {
    const url = new URL(link);
    return (
      url.protocol === "https:" &&
      (url.hostname === "teams.microsoft.com" || url.hostname === "teams.cloud.microsoft")
    );
  } catch {
    return false;
  }
}

/** The message exactly as it arrived (raw/<intakeId>.json), shown next to a
 *  draft so a person can check the model against the source. */
export function OriginalMessage({ intakeId, quote, className }: OriginalMessageProps) {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIntake(null);
    setError(null);
    fetchRaw(intakeId)
      .then((reply) => {
        if (cancelled) return;
        if (reply.ok) setIntake(reply.record.intake);
        else setError(reply.reason);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the original message.");
      });
    return () => {
      cancelled = true;
    };
  }, [intakeId]);

  if (error) return <p className="text-ink-muted p-3 text-[13px]">{error}</p>;
  if (!intake) return <p className="text-ink-faint p-3 text-[13px]">Loading original…</p>;

  const text = displayText(intake);
  const at = locateQuote(text, quote);
  const sender = [
    intake.sender.name,
    intake.sender.address && `<${intake.sender.address}>`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="border-border/60 flex flex-col gap-1 border-b pb-2">
        <div className="flex items-center gap-2">
          <SourceBadge source={intake.source} />
          <p className="text-ink min-w-0 flex-1 truncate text-[13px] font-semibold">
            {intake.subject || "(no subject)"}
          </p>
        </div>
        <p className="text-ink-muted text-[12px] break-words">
          {sender || "Unknown sender"}
          <span className="text-ink-faint">
            {" · "}
            {new Date(intake.receivedAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            })}
          </span>
        </p>
        {intake.recipients.length > 0 && (
          <p className="text-ink-faint text-[11px] break-words">
            To:{" "}
            {intake.recipients
              .map(
                (r) =>
                  `${r.name ?? r.address ?? "?"}${r.role && r.role !== "to" ? ` (${r.role})` : ""}`,
              )
              .join(", ")}
          </p>
        )}
        {isTeamsLink(intake.link) && (
          <a
            href={intake.link}
            target="_blank"
            rel="noreferrer"
            className="text-ink-muted hover:text-ink inline-flex items-center gap-1 self-start text-[11px] underline-offset-2 hover:underline"
          >
            Open in Teams <ArrowSquareOutIcon size={12} />
          </a>
        )}
      </div>
      <ScrollArea className="mt-2 min-h-0 flex-1">
        <p className="text-ink pr-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
          {at ? (
            <>
              {text.slice(0, at.start)}
              <mark
                data-testid="quote-highlight"
                className="bg-accent-subtle text-accent-800 rounded px-0.5"
              >
                {text.slice(at.start, at.end)}
              </mark>
              {text.slice(at.end)}
            </>
          ) : (
            text
          )}
        </p>
      </ScrollArea>
    </div>
  );
}
