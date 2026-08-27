"use client";

import { useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { ArrowRightIcon, UserIcon } from "@phosphor-icons/react";
import { Avatar, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { easeEntrance, easeExit, springSnappy, springWindow } from "@/lib/motion";
import { Wallpaper } from "@/components/desktop/Wallpaper";

/**
 * Live HH:MM clock, styled to sit directly on the dimmed wallpaper (white
 * text with a soft drop-shadow, not the usual `text-ink` — see LoginScreen's
 * doc comment below for why this screen is the one place that departs from
 * the ink/ink-muted convention). Ticks every second; only hours/minutes are
 * ever displayed, but re-rendering a couple of small text nodes once a
 * second is negligible for a screen that only ever exists before login.
 *
 * Mount-gated the same way AICursor/AIAnnotationBubble gate on `document`
 * (see those files): reading `new Date()` during a server render would bake
 * the server's clock/locale into the HTML, which will almost never match
 * the client's, so this renders a same-sized placeholder until the client
 * has mounted and can read its own clock.
 */
function LoginClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-[5.5rem] flex-col items-center justify-center gap-1 text-white">
      {now && (
        <>
          <span className="text-6xl font-medium tracking-tight tabular-nums [text-shadow:0_2px_20px_rgba(0,0,0,0.35)] sm:text-7xl">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="text-sm font-medium text-white/80 [text-shadow:0_1px_10px_rgba(0,0,0,0.35)]">
            {now.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </>
      )}
    </div>
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
 * The mocked lock screen shown before the desktop — there is no real user
 * or auth backend anywhere in this project, and the password field
 * intentionally accepts anything. The goal is purely the *feeling* of
 * unlocking a real desktop OS (macOS/Windows lock-screen conventions): the
 * real `<Wallpaper />` dimmed and blurred behind a centered clock and a
 * frosted "sign in" card, matching the dock/command bar's translucent
 * chrome treatment rather than a generic login form.
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
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isUnlocking) onUnlock();
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.02, filter: "blur(16px)" }}
      animate={
        isUnlocking
          ? { opacity: 0, scale: 1.06, filter: "blur(28px)" }
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
        if (isUnlocking) onExitComplete();
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
      <Wallpaper />
      {/* The dim + blur scrim — this, not Wallpaper itself, is what's
          "blurred/dimmed behind the login content". Wallpaper stays
          untouched so it's pixel-identical to the copy Desktop renders
          underneath. */}
      <div aria-hidden className="absolute inset-0 bg-neutral-900/25 backdrop-blur-2xl" />

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
        <LoginClock />

        <form
          onSubmit={handleSubmit}
          className="border-border/60 bg-surface-elevated/70 shadow-float-lg flex w-[min(22rem,88vw)] flex-col items-center gap-5 rounded-3xl border p-8 backdrop-blur-xl"
        >
          <Avatar
            fallback={<UserIcon size={40} weight="fill" />}
            size="lg"
            className="h-20 w-20"
          />
          <p className="text-ink text-base font-semibold">AI OS</p>

          <div className="relative w-full">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isUnlocking}
              autoFocus
              placeholder="Password"
              aria-label="Password"
              className={cn(
                "rounded-pill border-border bg-surface text-ink h-11 w-full border pr-11 pl-4 text-sm",
                "placeholder:text-ink-faint",
                "ease-standard transition-[border-color,box-shadow] duration-150",
                "focus-visible:border-accent focus-visible:ring-accent/30 focus-visible:ring-2 focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            />
            <IconButton
              type="submit"
              aria-label="Unlock"
              variant="solid"
              size="sm"
              disabled={isUnlocking}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <ArrowRightIcon size={15} weight="bold" />
            </IconButton>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
