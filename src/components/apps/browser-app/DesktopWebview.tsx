"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { EmbedBlocked, EmbedLoading } from "../web-app/EmbedStates";

/** Must match BROWSER_PARTITION in desktop/url-guard.cjs, which refuses any other. */
const BROWSER_PARTITION = "persist:ai-os-browser";

/** The subset of Electron's <webview> element used here. */
type WebviewElement = HTMLElement & { src: string };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** Real browsing inside the Electron shell: unlike an iframe, a <webview> is
 *  not subject to X-Frame-Options / frame-ancestors. */
export function DesktopWebview({ url }: { url: string }) {
  const ref = useRef<WebviewElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const host = hostnameOf(url);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onStop = () => setLoading(false);
    const onFail = (event: Event) => {
      const { errorCode, errorDescription, isMainFrame } = event as Event & {
        errorCode: number;
        errorDescription: string;
        isMainFrame: boolean;
      };
      // -3 is a navigation superseded by another one, not a failure.
      if (!isMainFrame || errorCode === -3) return;
      setFailure(errorDescription || "The page could not be loaded.");
      setLoading(false);
    };
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    return () => {
      el.removeEventListener("did-stop-loading", onStop);
      el.removeEventListener("did-fail-load", onFail);
    };
  }, []);

  if (failure) {
    return (
      <EmbedBlocked
        name={host}
        reason={failure}
        onOpenInNewTab={() => window.open(url, "_blank", "noopener,noreferrer")}
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      {loading && (
        <EmbedLoading
          label={`Loading ${host}…`}
          className="pointer-events-none absolute inset-0 z-[1] h-auto w-auto"
        />
      )}
      {createElement("webview", {
        ref,
        src: url,
        partition: BROWSER_PARTITION,
        className: cn("h-full w-full border-0", loading && "opacity-0"),
      })}
    </div>
  );
}
