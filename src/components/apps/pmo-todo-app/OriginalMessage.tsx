"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { displayText } from "@/lib/pmo/preprocess";
import { quoteSegments } from "@/lib/pmo/quote";
import type { Intake } from "@/lib/pmo/types";
import { fetchRaw } from "./api";
import { ScrollBody, SourceBadge, Spinner } from "./parts";

/** A long message can put the quote below the fold: bring it into view. */
const scrollIntoView = (element: HTMLElement | null) =>
  element?.scrollIntoView?.({ block: "nearest" });

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

  if (error)
    return (
      <p role="alert" className="text-red p-3 text-[13px] font-semibold">
        {error}
      </p>
    );
  if (!intake)
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4 p-3">
        <p className="text-ink-soft flex items-center gap-2 text-[13px] font-semibold">
          <Spinner />
          Loading original message…
        </p>
        <div aria-hidden className="flex flex-col gap-2.5 motion-safe:animate-pulse">
          {["w-3/4", "w-full", "w-5/6", "w-2/3"].map((width) => (
            <span key={width} className={`bg-chip h-3 rounded-full ${width}`} />
          ))}
        </div>
      </div>
    );

  const text = displayText(intake);
  const segments = quoteSegments(text, quote);
  const sender = [
    intake.sender.name,
    intake.sender.address && `<${intake.sender.address}>`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="border-line flex flex-col gap-1.5 border-b pb-3">
        <div className="flex items-center gap-2.5">
          <SourceBadge source={intake.source} />
          <p className="text-ink min-w-0 flex-1 truncate text-[14px] font-semibold">
            {intake.subject || "(no subject)"}
          </p>
        </div>
        <p className="text-ink-muted text-[12.5px] leading-relaxed break-words">
          {sender || "Unknown sender"}
          <span className="text-ink-muted">
            {" · "}
            {new Date(intake.receivedAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            })}
          </span>
        </p>
        {intake.recipients.length > 0 && (
          <p className="text-ink-muted text-[12px] break-words">
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
            className="text-ink-soft hover:text-ink focus-visible:ring-focus inline-flex items-center gap-1 self-start rounded text-[12px] font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2"
          >
            Open in Teams <ArrowSquareOutIcon size={12} />
          </a>
        )}
      </div>
      <ScrollBody className="mt-3 pr-2">
        <p className="text-ink text-[14px] leading-[1.65] break-words whitespace-pre-wrap">
          {segments.map((segment, index) =>
            segment.mark ? (
              <mark
                key={index}
                ref={scrollIntoView}
                data-testid="quote-highlight"
                className="bg-accent/25 rounded px-[3px] py-px text-inherit"
              >
                {segment.text}
              </mark>
            ) : (
              segment.text
            ),
          )}
        </p>
      </ScrollBody>
    </div>
  );
}
