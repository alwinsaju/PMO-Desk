"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { easeStandard } from "@/lib/motion";
import { EMBEDDABLE_IFRAME_SANDBOX, useEmbeddableUrl } from "@/lib/useEmbeddableUrl";
import { EmbedBlocked, EmbedLoading } from "../web-app/EmbedStates";

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
        className="h-full w-full"
      >
        <EmbedLoading label={`Loading ${host}…`} />
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
        className="h-full w-full"
      >
        <EmbedBlocked
          name={host}
          reason={check.reason}
          onOpenInNewTab={() => window.open(url, "_blank", "noopener,noreferrer")}
        />
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
        <EmbedLoading
          label={`Loading ${host}…`}
          className="bg-surface-elevated absolute inset-0 z-[1] h-auto w-auto"
        />
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
