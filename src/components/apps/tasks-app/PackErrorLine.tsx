"use client";

import { CopyDetailsButton } from "@/components/platform/CopyDetailsButton";

export interface PackErrorState {
  reason: string;
  detail?: string;
}

/** A failure in plain words, with "Copy details" for support. */
export function PackErrorLine({ error }: { error: PackErrorState }) {
  return (
    <p role="alert" className="text-red text-[13px]">
      {error.reason}
      {error.detail && (
        <CopyDetailsButton
          message={error.reason}
          detail={error.detail}
          where="Tasks > Packs"
        />
      )}
    </p>
  );
}
