"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useOpenNotificationFile } from "./OpenFileButtons";
import type { RunOutput } from "./historyRows";

/** "Open output" for one history row: opens the run's primary file through the engine. */
export function OpenOutputLink({
  taskId,
  output,
  className,
}: {
  taskId: string;
  output: RunOutput;
  className?: string;
}) {
  const { state, open } = useOpenNotificationFile(taskId, output.notification);
  const status = state[output.file.path];
  return (
    <button
      type="button"
      disabled={status === "opening"}
      onClick={() => void open(output.file.path)}
      title={
        status === "failed"
          ? "Couldn't open the file — open it from the output folder instead."
          : (output.file.label ?? "Open the file this run produced")
      }
      className={cn(
        "focus-visible:ring-focus rounded-chip inline-flex items-center gap-1 text-[12.5px] font-semibold outline-none hover:underline focus-visible:ring-2",
        status === "failed" ? "text-red" : "text-accent-ink",
        className,
      )}
    >
      <ArrowSquareOutIcon size={13} weight="bold" aria-hidden />
      {status === "opening"
        ? "Opening…"
        : status === "failed"
          ? "Couldn't open"
          : "Open output"}
    </button>
  );
}
