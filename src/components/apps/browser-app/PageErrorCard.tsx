"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Button, ErrorState } from "@/components/ui";
import {
  describeEmbedFailure,
  isOwnAddress,
  type EmbedFailureInput,
} from "./embedFailure";

/** A page that cannot be shown: the shared error card with Retry (when it could help)
 *  and a way out to the default browser (not for PMO Desk's own address, which that
 *  would only open as a second PMO Desk window). */
export function PageErrorCard({
  url,
  failure,
  onRetry,
}: {
  url: string;
  failure: EmbedFailureInput;
  onRetry: () => void;
}) {
  const text = describeEmbedFailure(failure);
  const own = typeof window !== "undefined" && isOwnAddress(url, window.location.origin);
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <ErrorState
        data-testid="browser-error"
        title={text.title}
        cause={text.cause}
        nextStep={own ? "Type a different address." : text.nextStep}
        detail={`${url}${failure.reason ? ` - ${failure.reason}` : ""}`}
        where="Browser"
        icon={<ArrowSquareOutIcon size={22} />}
        onRetry={text.retryable ? onRetry : undefined}
        actions={
          own ? undefined : (
            <Button
              size="sm"
              variant={text.retryable ? "outline" : "solid"}
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              Open in default browser
              <ArrowSquareOutIcon size={14} weight="bold" />
            </Button>
          )
        }
        className="bg-card border-line rounded-card shadow-float-sm motion-safe:animate-rise border"
      />
    </div>
  );
}
