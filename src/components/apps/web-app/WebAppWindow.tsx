"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useWindowStore } from "@/components/window-manager";
import { EMBEDDABLE_IFRAME_SANDBOX, useEmbeddableUrl } from "@/lib/useEmbeddableUrl";
import { EmbedBlocked, EmbedLoading } from "./EmbedStates";

/**
 * The one generic window for every REAL web app in the App Store catalog
 * (see src/components/app-store/appCatalog.ts's "Real web apps" section) —
 * registered under the fixed id "web-app". Every fictional catalog entry
 * still has no real window content and opens exactly as before; only real
 * entries route here (see AppStoreApp.tsx).
 *
 * Matches the `AppComponent` contract (`ComponentType<{ windowId: string }>`)
 * like every other app, but actually needs its `windowId` for more than a
 * debug attribute: `url`/`embeddable`/`title`/`icon` are read straight off
 * this window's own store entry rather than passed as props, because the
 * same "web-app" appId is reused for every real catalog entry — each open
 * window is a different instance pointed at a different URL.
 *
 * `embeddable` is never computed here. It's a static flag, hand-verified
 * once against the real site's actual response headers and stamped onto
 * the catalog entry ahead of time (see WindowState.embeddable's doc
 * comment) — a blocked cross-origin iframe can't be introspected from JS at
 * runtime, and a blocked frame often fires no distinguishing event, so
 * there is no reliable dynamic signal to branch on here.
 */
export function WebAppWindow({ windowId }: { windowId: string }) {
  const win = useWindowStore((s) => s.windows[windowId]);
  const [isLoading, setIsLoading] = useState(true);
  const [justOpened, setJustOpened] = useState(false);
  // `win.embeddable` is always a hand-verified flag here (see this
  // component's own doc comment above), never something to actually check
  // over the network — coalescing `undefined` to `false` preserves this
  // component's exact original semantics (no flag -> treated as blocked)
  // while still routing through the hook shared with the Browser app's
  // real-URL navigation. Called unconditionally, before the early return
  // below, same as the useState calls above it (rules of hooks).
  const embedCheck = useEmbeddableUrl(win?.url, win?.embeddable ?? false);

  if (!win?.url) {
    return (
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6 text-center"
      >
        <p className="text-ink-muted text-sm">No URL configured for this window.</p>
      </div>
    );
  }

  const { url, title, icon } = win;
  const isEmbeddable = embedCheck.status === "checked" && embedCheck.embeddable;

  if (isEmbeddable) {
    return (
      <div data-window-id={windowId} className="relative h-full w-full">
        {isLoading && (
          <EmbedLoading
            label={`Loading ${title}…`}
            className="bg-surface-elevated absolute inset-0 z-[1] h-auto w-auto"
          />
        )}
        {/* Sandbox permissions (and the reasoning behind them) live in
            EMBEDDABLE_IFRAME_SANDBOX's doc comment — shared verbatim with
            the Browser app's real-URL navigation, see src/lib/useEmbeddableUrl.ts. */}
        <iframe
          src={url}
          title={title}
          onLoad={() => setIsLoading(false)}
          sandbox={EMBEDDABLE_IFRAME_SANDBOX}
          className={cn(
            "h-full w-full border-0 transition-opacity duration-150",
            isLoading ? "opacity-0" : "opacity-100",
          )}
        />
      </div>
    );
  }

  function handleOpen() {
    window.open(url, "_blank", "noopener,noreferrer");
    setJustOpened(true);
  }

  return (
    <div data-window-id={windowId} className="h-full w-full">
      <EmbedBlocked
        name={title}
        icon={icon}
        onOpenInNewTab={handleOpen}
        footnote={justOpened ? `Opened ${title} in a new tab.` : undefined}
      />
    </div>
  );
}
