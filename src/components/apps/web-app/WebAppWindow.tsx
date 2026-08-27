"use client";

import { useState } from "react";
import { ArrowSquareOutIcon, CircleNotchIcon, GlobeIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useWindowStore } from "@/components/window-manager";

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

  if (!win?.url) {
    return (
      <div
        data-window-id={windowId}
        className="flex h-full w-full items-center justify-center p-6 text-center"
      >
        <p className="text-ink-faint text-sm">No URL configured for this window.</p>
      </div>
    );
  }

  const { url, embeddable, title, icon } = win;

  if (embeddable) {
    return (
      <div data-window-id={windowId} className="relative h-full w-full">
        {isLoading && (
          <div className="bg-surface-elevated absolute inset-0 flex items-center justify-center gap-2">
            <CircleNotchIcon
              size={16}
              weight="bold"
              className="text-ink-faint animate-spin"
            />
            <span className="text-ink-faint text-[13px]">Loading {title}…</span>
          </div>
        )}
        {/* Conservative on purpose: allow-same-origin/allow-scripts/allow-forms/
            allow-popups let a real site actually function (sign-in flows,
            forms, "open in new tab" links inside the page), but there is no
            allow-top-navigation (or -by-user-activation) here — an embedded
            page can never navigate or hijack this parent OS window. */}
        <iframe
          src={url}
          title={title}
          onLoad={() => setIsLoading(false)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
    <div
      data-window-id={windowId}
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <span className="text-ink-muted inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 [&_svg]:h-7 [&_svg]:w-7">
        {icon ?? <GlobeIcon size={28} />}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-ink text-[14px] font-semibold">
          Can&apos;t embed {title} here
        </p>
        <p className="text-ink-muted text-[13px] leading-relaxed">
          {title} blocks other sites from displaying it in a frame — a real, common
          security setting, not something broken here. Open it in a regular browser tab
          instead.
        </p>
      </div>
      <Button variant="solid" onClick={handleOpen} className="gap-1.5">
        Open in new tab
        <ArrowSquareOutIcon size={15} weight="bold" />
      </Button>
      {justOpened && (
        <p className="text-ink-faint text-[12px]">Opened {title} in a new tab.</p>
      )}
    </div>
  );
}
