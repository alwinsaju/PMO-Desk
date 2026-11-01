"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion } from "motion/react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { ArrowRightIcon, UserIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { trapTarget } from "@/lib/focusKeys";
import { easeEntrance, easeExit, springSnappy, springWindow } from "@/lib/motion";
import { PmoDeskMark } from "@/components/brand/PmoDeskMark";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { useDockBadgeStore } from "@/components/taskbar/dockBadgeStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { useUserIdentity } from "./userIdentityStore";

/** "9:41" — the locale's own hour/minute formatting, minus the AM/PM marker
 *  (at this size it just adds noise; the date line carries the context). */
function formatClock(date: Date): string {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

/**
 * Live HH:MM clock, styled to sit directly on the dimmed wallpaper (white
 * text with a soft drop-shadow, not the usual `text-ink` — see LoginScreen's
 * doc comment below for why this screen is the one place that departs from
 * the ink/ink-muted convention). It is the screen's headline: very large,
 * `font-headline` (bold by default, the brand's light weight in Deloitte
 * mode) with tight tracking. Ticks every second; only hours/minutes are ever
 * displayed, but re-rendering a couple of small text nodes once a second is
 * negligible for a screen that only ever exists before login.
 *
 * Mount-gated the same way AICursor/AIAnnotationBubble gate on `document`
 * (see those files): reading `new Date()` during a server render would bake
 * the server's clock/locale into the HTML, which will almost never match
 * the client's, so this renders an invisible same-sized placeholder until the
 * client has mounted and can read its own clock.
 */
function LoginClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 text-center text-white",
        "[text-shadow:0_2px_30px_rgba(40,30,80,0.3)]",
        !now && "invisible",
      )}
    >
      <span className="font-headline text-[clamp(5rem,15vw,9.25rem)] leading-none tracking-[-0.06em] tabular-nums">
        {now ? formatClock(now) : "00:00"}
      </span>
      <span className="text-[clamp(1rem,2.4vw,1.3125rem)] font-medium opacity-95">
        {(now ?? new Date(0)).toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </span>
    </div>
  );
}

/** One line under the clock: what needs the person ("3 need attention: 2 PMO items, ...").
 *  Hidden with the Settings toggle, and while nothing needs them (or nothing has loaded). */
function LockSummary() {
  const on = usePreferences((s) => s.lockSummary);
  const meaning = useDockBadgeStore((s) => s.meanings.dashboard);
  if (!on || !meaning) return null;
  return (
    <p
      role="status"
      className="max-w-[min(34rem,88vw)] rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-center text-[14px] font-medium text-white [text-shadow:0_2px_14px_rgba(40,30,80,0.3)]"
    >
      {meaning}
    </p>
  );
}

/** True when Settings > Hardware acceleration is on (`data-fx="rich"`, see displayFx.ts). */
function isRichFx(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.dataset.fx === "rich"
  );
}

export interface LoginScreenProps {
  /** True once the user has triggered unlock — drives the exit animation. */
  isUnlocking: boolean;
  /** Called the moment the user asks to unlock (submit, or click the arrow). */
  onUnlock: () => void;
  /** Called once the exit animation has fully finished playing. */
  onExitComplete: () => void;
}

/**
 * The lock screen shown before the desktop — there is no real user or auth
 * backend anywhere in this project, so it asks for nothing: just
 * "Press Enter or click Continue" (a password field here would look like
 * security it does not provide). The goal is the *feeling* of
 * unlocking a real desktop OS (macOS/Windows lock-screen conventions): the
 * real `<Wallpaper />` tinted and heavily blurred behind a huge clock and a
 * frosted "sign in" card (avatar, name, a translucent password pill with a
 * round arrow button), matching the dock/command bar's translucent chrome
 * rather than a generic login form.
 *
 * Everything sits on the dark wallpaper scrim, so the text here is white (the
 * one place that departs from the ink/ink-muted convention) and the card and
 * input are white-on-glass instead of token fills — which keeps them legible
 * in all four theme x brand combinations. The scrim itself swaps per theme
 * (indigo tint / near-black / Deloitte charcoal).
 *
 * Reusing `<Wallpaper />` here (instead of a second background) means the
 * unlock transition reads as "the blur lifts off this exact wallpaper" —
 * LoginGate keeps the real `Desktop` (which renders its own `<Wallpaper />`)
 * mounted underneath the whole time, so what's revealed as this component
 * fades/blurs/scales away is pixel-identical to what was dimmed on top of
 * it, rather than a cut to a different image.
 *
 * Exit is animation-gated the same way Window.tsx gates close/minimize:
 * `isUnlocking` flips the `animate` target on a persistent `motion.div`
 * (never mounted/unmounted via AnimatePresence — see AICursor.tsx's doc
 * comment on why that mechanism isn't reliable in this project's React 19 +
 * motion setup) and only `onAnimationComplete` tells LoginGate the visual
 * transition is actually done, so it can hide this screen for good.
 */
export function LoginScreen({ isUnlocking, onUnlock, onExitComplete }: LoginScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
  }, []);
  const identity = useUserIdentity((s) => s.identity);
  useEffect(() => {
    void useUserIdentity.getState().load();
  }, []);

  // Tab/Shift+Tab cycle through the lock screen's own controls only.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("input, button"),
    ).filter((el) => !(el as HTMLInputElement | HTMLButtonElement).disabled);
    const next = trapTarget(
      items.indexOf(document.activeElement as HTMLElement),
      items.length,
      event.shiftKey,
    );
    event.preventDefault();
    if (next !== null) items[next].focus();
  }

  // The blur-in leaves `filter: blur(0px)` on this full-screen element, and a
  // filtered full-viewport layer is re-rendered on every frame by a software
  // compositor (measured: 47 fps idle vs 62 without). Once the entrance is done
  // drop the filter entirely; put the no-op blur back just before the exit
  // animation so it still starts from `blur(0px)`.
  //
  // Lean mode (no GPU effects) exits differently: fading or scaling the whole
  // layer re-rasterizes the wallpaper every frame (measured 8 fps on a software
  // compositor), but that wallpaper is pixel-identical to the desktop's beneath
  // it. So only the scrim and the card fade; the lock screen is removed once
  // they are gone and the wallpaper simply stays put.
  const rich = isRichFx();
  useLayoutEffect(() => {
    if (isUnlocking && rich && rootRef.current)
      rootRef.current.style.filter = "blur(0px)";
  }, [isUnlocking, rich]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isUnlocking) onUnlock();
  }

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Lock screen"
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, scale: 1.02, filter: "blur(16px)" }}
      animate={
        isUnlocking
          ? rich
            ? { opacity: 0, scale: 1.06, filter: "blur(28px)" }
            : { opacity: 1, scale: 1 }
          : { opacity: 1, scale: 1, filter: "blur(0px)" }
      }
      transition={{
        scale: springWindow,
        opacity: {
          duration: isUnlocking ? 0.6 : 0.5,
          ease: isUnlocking ? easeExit : easeEntrance,
        },
        filter: {
          duration: isUnlocking ? 0.6 : 0.5,
          ease: isUnlocking ? easeExit : easeEntrance,
        },
      }}
      onAnimationComplete={() => {
        if (isUnlocking) {
          if (rich) onExitComplete();
        } else {
          // Motion writes its final style after this callback, so wait a beat.
          const el = rootRef.current;
          if (el) window.setTimeout(() => (el.style.filter = "none"), 60);
        }
      }}
      // z-[overlay + 1]: this gate sits above literally everything else in
      // the app, including the `--z-overlay` layer (dialogs/popovers/
      // tooltips) — reading the token via calc() instead of a hardcoded
      // literal so it stays correctly on top even if that value ever
      // changes, without this file needing to touch tokens.css.
      className={cn(
        "fixed inset-0 z-[calc(var(--z-overlay)+1)] flex items-center justify-center",
        isUnlocking && "pointer-events-none",
      )}
    >
      <Wallpaper logo={false} />
      {/* The tint + saturation scrim — this, not Wallpaper itself, is what's
          "dimmed behind the login content". Wallpaper stays untouched so it's
          pixel-identical to the copy Desktop renders underneath. There is no
          backdrop-blur here (it used to be 46px): the wallpaper behind is
          already a smooth gradient, so the blur changed nothing visible (mean
          pixel diff 0.6/255) but cost ~200 ms per frame on a software
          compositor. */}
      <motion.div
        aria-hidden
        animate={{ opacity: isUnlocking && !rich ? 0 : 1 }}
        transition={{ duration: 0.35, ease: easeExit }}
        onAnimationComplete={() => {
          if (isUnlocking && !rich) onExitComplete();
        }}
        className={cn(
          "fx-rich:backdrop-saturate-150 absolute inset-0",
          // Rich effects mode (Settings > Hardware acceleration): the original
          // full-screen blur, too slow without a GPU.
          "fx-rich:backdrop-blur-[46px]",
          "bg-[linear-gradient(180deg,rgba(38,44,96,0.42),rgba(80,44,92,0.5))]",
          "dark:bg-[rgba(10,10,28,0.42)]",
          "brand-dl:bg-[linear-gradient(180deg,rgba(40,39,40,0.55),rgba(0,0,0,0.6))]",
        )}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={
          isUnlocking
            ? { opacity: 0, y: -12, scale: 0.94 }
            : { opacity: 1, y: 0, scale: 1 }
        }
        transition={{
          y: {
            duration: isUnlocking ? 0.28 : 0.5,
            ease: isUnlocking ? easeExit : easeEntrance,
          },
          opacity: {
            duration: isUnlocking ? 0.28 : 0.5,
            ease: isUnlocking ? easeExit : easeEntrance,
          },
          scale: springSnappy,
        }}
        className="relative flex flex-col items-center gap-10 px-6"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex items-center gap-3 text-white [text-shadow:0_2px_14px_rgba(40,30,80,0.3)]"
            data-testid="login-brand"
          >
            <PmoDeskMark size={44} variant="dark" title="" />
            <span className="font-headline text-[26px] leading-none">PMO Desk</span>
          </div>
          <LoginClock />
          <LockSummary />
        </div>
        <form
          onSubmit={handleSubmit}
          className={cn(
            "rounded-surface flex w-[min(22.5rem,88vw)] flex-col items-center gap-4 px-7 py-8 text-white",
            "fx-rich:backdrop-blur-2xl border border-white/25 bg-white/10",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_30px_60px_-24px_rgba(10,10,30,0.55)]",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "text-accent-contrast grid h-[84px] w-[84px] place-items-center rounded-full",
              "bg-[linear-gradient(145deg,var(--color-accent-2),var(--color-accent))]",
              "border-[3px] border-white/55",
              "shadow-[0_14px_34px_-8px_rgba(20,60,50,0.5),inset_0_1px_0_rgba(255,255,255,0.4)]",
            )}
          >
            <AvatarPrimitive.Root className="grid h-full w-full place-items-center overflow-hidden rounded-full">
              {identity.photoUrl && (
                <AvatarPrimitive.Image
                  src={identity.photoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              <AvatarPrimitive.Fallback className="grid h-full w-full place-items-center">
                {identity.initials ? (
                  <span className="font-headline text-[32px] leading-none">
                    {identity.initials}
                  </span>
                ) : (
                  <UserIcon size={40} weight="fill" />
                )}
              </AvatarPrimitive.Fallback>
            </AvatarPrimitive.Root>
          </span>
          <div className="text-center [text-shadow:0_2px_14px_rgba(40,30,80,0.3)]">
            {identity.name && <p className="text-[13px] text-white/85">Welcome back</p>}
            <p className="text-xl font-semibold">{identity.name || "Welcome"}</p>
          </div>

          <button
            type="submit"
            ref={continueRef}
            disabled={isUnlocking}
            className={cn(
              "rounded-bar flex h-[52px] w-full items-center justify-center gap-2.5 bg-white text-base font-semibold text-[#14302b]",
              "ease-spring transition-transform duration-[400ms] hover:scale-[1.03]",
              "focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 focus-visible:outline-none",
              "disabled:opacity-60",
            )}
          >
            Continue
            <ArrowRightIcon size={18} weight="bold" />
          </button>
          <p className="text-[13px] text-white/85">Press Enter or click Continue</p>
        </form>
        <span
          aria-hidden
          className="brand-dl:block hidden h-6 w-32 bg-[url('/brand/deloitte-dark.png')] bg-contain bg-center bg-no-repeat"
        />
      </motion.div>
    </motion.div>
  );
}
