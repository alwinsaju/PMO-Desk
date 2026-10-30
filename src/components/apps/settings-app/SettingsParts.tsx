"use client";

import type { ReactNode } from "react";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";

/** One setting: a title, an optional hint and its control on the right. */
export function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-line flex items-center gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-ink text-[14px] font-semibold">{title}</p>
        {hint && (
          <p className="text-ink-muted mt-0.5 text-[12.5px] leading-snug">{hint}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-ink-muted mb-1 text-[12px] font-bold tracking-[0.06em] uppercase">
        {title}
      </h2>
      <div>{children}</div>
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
