"use client";

import type { ReactNode } from "react";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";

/** One setting: a title, an optional hint and its control on the right. `settingId` is what
 *  Settings search jumps to (see lib/settings/settingsIndex.ts). */
export function Row({
  title,
  hint,
  settingId,
  children,
}: {
  title: string;
  hint?: string;
  settingId?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-setting-id={settingId}
      className="border-line rounded-control data-[flash=true]:bg-accent-soft flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-1 py-3 transition-colors duration-500 last:border-b-0"
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-ink text-[14px] font-semibold">{title}</p>
        {hint && (
          <p className="text-ink-muted mt-0.5 text-[12.5px] leading-snug">{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/** A card with a header: one group of related settings. */
export function Section({
  title,
  description,
  settingId,
  children,
}: {
  title: string;
  description?: string;
  /** Lets Settings search jump to this whole card (see `Row`). */
  settingId?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-setting-id={settingId}
      className="border-line bg-card rounded-card data-[flash=true]:border-accent mb-4 border px-5 pt-4 pb-3 transition-colors duration-500"
    >
      <h2 className="text-ink type-section-title">{title}</h2>
      {description && (
        <p className="text-ink-muted mt-0.5 text-[12.5px]">{description}</p>
      )}
      <div className="mt-1">{children}</div>
    </section>
  );
}

export const when = (at: number | string) =>
  new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A failure or a confirmation line under a control. An error can carry the cleaned technical text for "Copy details". */
export function Note({
  tone = "info",
  detail,
  children,
}: {
  tone?: "info" | "error" | "success";
  detail?: string;
  children: ReactNode;
}) {
  const colour =
    tone === "error"
      ? "text-red"
      : tone === "success"
        ? "text-success-dot"
        : "text-ink-muted";
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`${colour} mt-2 text-[12.5px]`}
    >
      {children}
      {tone === "error" && detail && (
        <CopyDetailsButton message={String(children)} detail={detail} where="Settings" />
      )}
    </p>
  );
}
