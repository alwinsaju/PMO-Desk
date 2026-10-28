"use client";

import { useEffect, useState } from "react";

/**
 * Sandbox permissions for embedding a REAL, cross-origin site inside this
 * OS's own chrome — shared verbatim by every place that does this
 * (currently `WebAppWindow.tsx`'s App Store web apps, and the Browser
 * app's real-URL navigation). Conservative on purpose: allow-scripts/
 * allow-same-origin/allow-forms/allow-popups let a real site actually
 * function (sign-in flows, forms, "open in new tab" links inside the
 * page), but there is deliberately no allow-top-navigation (or
 * -by-user-activation) — an embedded page can never navigate or hijack
 * this parent OS window.
 */
export const EMBEDDABLE_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups";

export type EmbeddableCheck =
  /** No url to check yet (e.g. nothing navigated to). */
  | { status: "unknown" }
  /** A live HTTP header check is in flight. Only ever happens when
   *  `knownEmbeddable` is omitted — see the hook's doc comment below. */
  | { status: "checking" }
  | { status: "checked"; embeddable: boolean; reason?: string };

/**
 * Resolves whether `url` can be embedded in this OS's sandboxed iframe
 * (`EMBEDDABLE_IFRAME_SANDBOX` above) — the one piece of logic
 * `WebAppWindow.tsx` and the Browser app's real-URL navigation both need,
 * factored out here so neither re-derives (or duplicates) it independently.
 *
 * `WindowState.embeddable`'s doc comment (src/components/window-manager/
 * types.ts) explains why this generally can't be determined from a live
 * iframe at runtime: a blocked cross-origin frame can't be introspected
 * from JS, and a blocked frame often fires no distinguishing load/error
 * event either way. WebAppWindow.tsx sidesteps that entirely — every App
 * Store catalog entry ships a static, hand-verified `embeddable` flag (see
 * appCatalog.ts's "Real web apps" comments) — and passing that flag here
 * as `knownEmbeddable` makes this hook a pure, synchronous passthrough
 * that never touches the network, so its existing behavior is unchanged.
 *
 * The Browser app has no such fixed catalog — the user can type ANY url —
 * so it calls this with `knownEmbeddable` omitted. That's the one case
 * this hook does real work: it asks `/api/browser/check-embeddable`, a
 * tiny server route that runs the exact real HTTP header check
 * (`X-Frame-Options` / CSP `frame-ancestors`) appCatalog.ts's comments
 * describe doing by hand, once, for that fixed catalog — automated here to
 * run live, per request, for whatever the user just typed.
 */
export function useEmbeddableUrl(
  url: string | undefined,
  knownEmbeddable?: boolean,
): EmbeddableCheck {
  const [state, setState] = useState<EmbeddableCheck>(() =>
    computeKnownState(url, knownEmbeddable),
  );

  useEffect(() => {
    if (!url || knownEmbeddable !== undefined) {
      // Nothing to check over the network — keep state in sync with the
      // latest inputs (matters if they ever change after mount; neither
      // current caller does, but the hook should stay correct if that
      // changes) without ever calling out.
      setState(computeKnownState(url, knownEmbeddable));
      return;
    }

    setState({ status: "checking" });
    const controller = new AbortController();

    fetch(`/api/browser/check-embeddable?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`check-embeddable responded ${res.status}`);
        return res.json() as Promise<{ embeddable: boolean; reason?: string }>;
      })
      .then((data) => {
        setState({ status: "checked", embeddable: data.embeddable, reason: data.reason });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Fails closed: an unreachable/erroring check lands on the same
        // graceful "open in a new tab" fallback as a genuinely blocked
        // site, never a permanently blank/broken iframe.
        console.error("useEmbeddableUrl: check-embeddable failed", err);
        setState({ status: "checked", embeddable: false });
      });

    return () => controller.abort();
  }, [url, knownEmbeddable]);

  return state;
}

function computeKnownState(
  url: string | undefined,
  knownEmbeddable: boolean | undefined,
): EmbeddableCheck {
  if (!url) return { status: "unknown" };
  if (knownEmbeddable !== undefined)
    return { status: "checked", embeddable: knownEmbeddable };
  return { status: "checking" };
}
