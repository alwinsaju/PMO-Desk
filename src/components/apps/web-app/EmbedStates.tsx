"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowSquareOutIcon, GlobeIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Visual states shared by every window that frames a real site: the generic
 * web-app window (`WebAppWindow.tsx`) and the Browser app's real-URL page
 * (`browser-app/UrlPage.tsx`). Markup only — the embeddability check, the
 * iframe load tracking and the "Open in new tab" action all stay with the
 * callers, so both windows keep looking identical without re-deriving it.
 */

/** The `--ease-smooth` bezier, as the tuple `motion` wants. */
const EASE_SMOOTH = [0.22, 0.9, 0.28, 1] as const;

/**
 * Thin accent progress bar pinned to the top edge of the nearest positioned
 * ancestor, growing to 92% while something loads. Render it only WHILE
 * loading (mounting restarts the growth); unmounting it ends the effect.
 */
export function LoadBar() {
  return (
    <motion.div
      aria-hidden
      initial={{ width: 0 }}
      animate={{ width: "92%" }}
      transition={{ duration: 0.6, ease: EASE_SMOOTH }}
      className="from-accent to-accent-2 pointer-events-none absolute top-0 left-0 z-10 h-[3px] rounded-r-[2px] bg-linear-to-r"
    />
  );
}

/** Spinner ring in the current text color (accent-ink by default; pass
 *  `text-inherit` to follow a parent, e.g. a button label). Also the ring the
 *  App Store's installing state uses. */
export function SpinnerRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "animate-rot text-accent-ink inline-block h-4 w-4 shrink-0 rounded-full border-2 border-current/30 border-t-current",
        className,
      )}
    />
  );
}

interface EmbedLoadingProps {
  /** Shown beside the spinner, e.g. "Loading Wikipedia…". */
  label: string;
  /** Defaults to filling a positioned parent flow-wise; pass
   *  `absolute inset-0 bg-surface-elevated` to overlay a loading iframe. */
  className?: string;
}

/** Centred spinner + label under the loading bar. */
export function EmbedLoading({ label, className }: EmbedLoadingProps) {
  return (
    <div
      role="status"
      className={cn(
        "relative flex h-full w-full items-center justify-center gap-2.5",
        className,
      )}
    >
      <LoadBar />
      <SpinnerRing />
      <span className="text-ink-muted text-[13px]">{label}</span>
    </div>
  );
}

interface EmbedBlockedProps {
  /** Site name or host, used in the headline ("Can't embed {name} here"). */
  name: string;
  /** Glyph for the icon tile; defaults to a globe. */
  icon?: ReactNode;
  onOpenInNewTab: () => void;
  /** Extra line under the button (e.g. "Opened X in a new tab."). */
  footnote?: ReactNode;
}

/** The "this site refuses to be framed" fallback: an inset glass card with
 *  the explanation and the single way forward (open it in a real tab). */
export function EmbedBlocked({
  name,
  icon,
  onOpenInNewTab,
  footnote,
}: EmbedBlockedProps) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="rounded-card bg-card border-line shadow-float-sm motion-safe:animate-rise flex w-full max-w-md flex-col items-center gap-5 border px-8 py-9 text-center">
        <span className="rounded-tile bg-accent-soft text-accent-ink inline-flex h-16 w-16 shrink-0 items-center justify-center [&_svg]:h-7 [&_svg]:w-7">
          {icon ?? <GlobeIcon size={28} />}
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-ink text-[15px] font-semibold">
            Can&apos;t embed {name} here
          </p>
          <p className="text-ink-muted text-[13px] leading-relaxed">
            {name} blocks other sites from displaying it in a frame — a real, common
            security setting, not something broken here. Open it in a regular browser tab
            instead.
          </p>
        </div>
        <Button onClick={onOpenInNewTab} className="gap-1.5">
          Open in new tab
          <ArrowSquareOutIcon size={15} weight="bold" />
        </Button>
        {footnote && <p className="text-ink-faint -mt-1 text-[12px]">{footnote}</p>}
      </div>
    </div>
  );
}
