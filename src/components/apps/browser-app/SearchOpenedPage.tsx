"use client";

import { ArrowSquareOutIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

/** Shown after a search was handed to the OS browser (search engines do not
 *  allow being framed, so the Browser app never embeds them). */
export function SearchOpenedPage({
  query,
  onOpenAgain,
}: {
  query: string;
  onOpenAgain: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="rounded-card bg-card border-line shadow-float-sm flex w-full max-w-md flex-col items-center gap-5 border px-8 py-9 text-center">
        <span className="rounded-tile bg-accent-soft text-accent-ink inline-flex h-16 w-16 items-center justify-center">
          <MagnifyingGlassIcon size={28} />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-ink text-[15px] font-semibold">
            Opened your search in your browser
          </p>
          <p className="text-ink-muted text-[13px] leading-relaxed break-words">
            &ldquo;{query}&rdquo;
          </p>
        </div>
        <Button onClick={onOpenAgain} className="gap-1.5">
          Open again
          <ArrowSquareOutIcon size={15} weight="bold" />
        </Button>
      </div>
    </div>
  );
}
