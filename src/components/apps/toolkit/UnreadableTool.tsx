"use client";

import { WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";

/** What a tool shows when its saved data cannot be read, instead of an empty list that looks like a fresh start. */
export function UnreadableTool({
  title,
  blurb,
  error,
  onRetry,
}: {
  title: string;
  blurb?: string;
  error: { reason: string; detail?: string };
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="px-6 pt-1" data-testid="tool-unreadable">
      {blurb && <p className="text-ink-muted text-[13px]">{blurb}</p>}
      <div
        role="alert"
        className="bg-red-soft rounded-card mt-3 flex max-w-2xl flex-col gap-2 px-4 py-3 text-[13px]"
      >
        <p className="text-red flex items-center gap-2 font-semibold">
          <WarningIcon size={16} weight="fill" aria-hidden />
          {title} cannot be opened
        </p>
        <p className="text-ink-soft">{error.reason}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void onRetry()}>
            Try again
          </Button>
          {error.detail && (
            <CopyDetailsButton
              message={error.reason}
              detail={error.detail}
              where={title}
            />
          )}
        </div>
      </div>
    </div>
  );
}
