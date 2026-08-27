"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowSquareOutIcon, CircleNotchIcon, GlobeIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeStandard } from "@/lib/motion";
import { EMBEDDABLE_IFRAME_SANDBOX, useEmbeddableUrl } from "@/lib/useEmbeddableUrl";

/** Shared by this file's 3 mutually-exclusive return states (checking /
 *  blocked / embeddable) so each one fades in on mount instead of hard-
 *  cutting from the last — a plain mount animation, not an animated exit:
 *  whichever state was showing simply disappears the instant the next one
 *  mounts, same as before this existed (see AICursor.tsx's doc comment for
 *  why this project avoids AnimatePresence's `exit` here). */
const STATE_TRANSITION = { duration: 0.15, ease: easeStandard };

interface UrlPageProps {
  url: string;
  /** Cached result of a previous check for this exact url (BrowserApp.tsx
   *  keeps a ref-based cache so revisiting a url via back/forward doesn't
   *  re-hit the network) — see `useEmbeddableUrl`'s `knownEmbeddable`. */
  knownEmbeddable?: boolean;
  /** Reports a freshly-resolved check back up so BrowserApp.tsx can cache
   *  it. Not called at all when `knownEmbeddable` was already supplied. */
  onEmbeddableResolved: (url: string, embeddable: boolean) => void;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Renders one real, user-navigated URL inside the Browser app's content
 * area — the exact same sandboxed-iframe-with-graceful-new-tab-fallback
 * approach `WebAppWindow.tsx` uses for the App Store's real web apps,
 * shared via `useEmbeddableUrl`/`EMBEDDABLE_IFRAME_SANDBOX`
 * (src/lib/useEmbeddableUrl.ts) rather than re-derived here.
 *
 * Unlike WebAppWindow.tsx, `embeddable` usually isn't known ahead of
 * time — the user can type any url, not just one of the App Store's
 * hand-verified catalog entries — so this also renders a brief "checking"
 * state while `useEmbeddableUrl` resolves that over the network.
 *
 * BrowserApp.tsx mounts a fresh instance of this per distinct
 * `url`/reload (see its `key`), so every piece of state below starts
 * clean on each real navigation instead of needing to be reset by hand.
 */
export function UrlPage({ url, knownEmbeddable, onEmbeddableResolved }: UrlPageProps) {
  const [isFrameLoading, setIsFrameLoading] = useState(true);
  const check = useEmbeddableUrl(url, knownEmbeddable);
  const host = hostnameOf(url);

  useEffect(() => {
    if (check.status === "checked") onEmbeddableResolved(url, check.embeddable);
  }, [check, url, onEmbeddableResolved]);

  if (check.status !== "checked") {
    return (
      <motion.div
        key="checking"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={STATE_TRANSITION}
        className="flex h-full w-full items-center justify-center gap-2"
      >
        <CircleNotchIcon
          size={16}
          weight="bold"
          className="text-ink-faint animate-spin"
        />
        <span className="text-ink-faint text-[13px]">Loading {host}…</span>
      </motion.div>
    );
  }

  if (!check.embeddable) {
    return (
      <motion.div
        key="blocked"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={STATE_TRANSITION}
        className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <span className="text-ink-muted inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 [&_svg]:h-7 [&_svg]:w-7">
          <GlobeIcon size={28} />
        </span>
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-ink text-[14px] font-semibold">
            Can&apos;t embed {host} here
          </p>
          <p className="text-ink-muted text-[13px] leading-relaxed">
            {host} blocks other sites from displaying it in a frame — a real, common
            security setting, not something broken here. Open it in a regular browser tab
            instead.
          </p>
        </div>
        <Button
          variant="solid"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          className="gap-1.5"
        >
          Open in new tab
          <ArrowSquareOutIcon size={15} weight="bold" />
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="frame"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={STATE_TRANSITION}
      className="relative h-full w-full"
    >
      {isFrameLoading && (
        <div className="bg-surface-elevated absolute inset-0 flex items-center justify-center gap-2">
          <CircleNotchIcon
            size={16}
            weight="bold"
            className="text-ink-faint animate-spin"
          />
          <span className="text-ink-faint text-[13px]">Loading {host}…</span>
        </div>
      )}
      {/* Same conservative sandbox WebAppWindow.tsx uses — see
          EMBEDDABLE_IFRAME_SANDBOX's doc comment for why. */}
      <iframe
        src={url}
        title={host}
        onLoad={() => setIsFrameLoading(false)}
        sandbox={EMBEDDABLE_IFRAME_SANDBOX}
        className={cn(
          "h-full w-full border-0 transition-opacity duration-150",
          isFrameLoading ? "opacity-0" : "opacity-100",
        )}
      />
    </motion.div>
  );
}
