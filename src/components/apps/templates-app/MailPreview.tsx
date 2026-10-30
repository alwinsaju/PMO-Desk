"use client";

import { boldSegments } from "@/lib/templates/render";

/** The message laid out like a draft in the mail program: header lines, then the text in the same font and
 *  paragraph spacing the tasks write into Outlook. A picture of the result, not a sender. */
export function MailPreview({
  from,
  to,
  cc,
  subject,
  body,
}: {
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** The message with `**bold**` markers kept. */
  body: string;
}) {
  const paragraphs = body.split(/\n{2,}/);
  return (
    <div
      data-testid="mail-preview"
      className="overflow-hidden rounded-[6px] border border-[#d1d5db] bg-white text-[#2d2d2d] shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-[#e5e7eb] bg-[#f3f4f6] px-3 py-1.5 text-[11px] font-semibold text-[#4b5563]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#9ca3af]" />
        New message (draft, not sent)
      </div>
      <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 border-b border-[#e5e7eb] px-3 py-2 text-[12px]">
        <dt className="text-[#6b7280]">From</dt>
        <dd className="break-words">{from}</dd>
        <dt className="text-[#6b7280]">To</dt>
        <dd className="break-words">
          {to || <span className="text-[#9ca3af]">(set by the task)</span>}
        </dd>
        {cc && (
          <>
            <dt className="text-[#6b7280]">Cc</dt>
            <dd className="break-words">{cc}</dd>
          </>
        )}
        <dt className="text-[#6b7280]">Subject</dt>
        <dd className="font-semibold break-words">
          {subject || <span className="text-[#9ca3af]">(set by the task)</span>}
        </dd>
      </dl>
      <div
        className="px-3 py-3 text-[14.67px] leading-[1.35]"
        style={{ fontFamily: "'Aptos Narrow', 'Segoe UI', sans-serif" }}
      >
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-3 break-words whitespace-pre-wrap last:mb-0">
            {boldSegments(p).map((part, j) =>
              part.bold ? (
                <strong key={j}>{part.text}</strong>
              ) : (
                <span key={j}>{part.text}</span>
              ),
            )}
          </p>
        ))}
        {body.trim() === "" && (
          <span className="text-[#9ca3af]">The message appears here.</span>
        )}
      </div>
    </div>
  );
}
