"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import {
  isEmptyPreview,
  parseReportPreview,
  type PreviewSection,
} from "@/lib/pmo/reportPreview";
import { Chip, SectionLabel } from "./parts";

/** The report as it will read: a card with the title, the summary as tiles and
 *  each section as a headed list. It draws the editor's current text, plain
 *  text only (never HTML), so an edit shows up here at once. */
export function ReportPreviewCard({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const preview = useMemo(() => parseReportPreview(text), [text]);
  if (isEmptyPreview(preview))
    return (
      <p className="text-ink-muted text-[13.5px]">
        The report text is empty. Switch to Edit to write it, or generate it again.
      </p>
    );
  return (
    <article
      aria-label="Report preview"
      data-testid="report-preview"
      className={cn(
        "border-line bg-surface-elevated rounded-card flex flex-col gap-5 border p-5 @md:p-7",
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        {preview.title && (
          <h3 className="text-ink text-[20px] leading-tight font-bold break-words">
            {preview.title}
          </h3>
        )}
        {preview.intro.map((line) => (
          <p key={line} className="text-ink-muted text-[13px] leading-snug">
            {line}
          </p>
        ))}
      </header>
      {preview.sections.map((section, index) => (
        <PreviewBlock key={`${section.heading}-${index}`} section={section} />
      ))}
    </article>
  );
}

function PreviewBlock({ section }: { section: PreviewSection }) {
  return (
    <section aria-label={section.heading} className="flex flex-col gap-2">
      <SectionLabel className="border-line flex items-center gap-2 border-b pb-1.5">
        {section.heading}
        {section.count !== null && <Chip tone="neutral">{section.count}</Chip>}
      </SectionLabel>
      {section.stats ? (
        <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-3">
          {section.stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-chip rounded-control flex flex-col gap-0.5 px-3 py-2"
            >
              <dt className="text-ink-muted text-[12px]">{stat.label}</dt>
              <dd className="text-ink text-[15px] font-semibold break-words">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <>
          {section.notes.map((note) => (
            <p key={note} className="text-ink-soft text-[13.5px] leading-snug">
              {note}
            </p>
          ))}
          {section.bullets.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {section.bullets.map((bullet, i) => (
                <li
                  key={`${bullet}-${i}`}
                  className={cn(
                    "text-[13.5px] leading-snug break-words",
                    bullet === "None." ? "text-ink-muted -ml-5 list-none" : "text-ink",
                  )}
                >
                  {bullet}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
