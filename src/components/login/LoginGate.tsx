"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import { LoginScreen } from "./LoginScreen";

/** sessionStorage (not localStorage): once unlocked, stay unlocked for the
 *  rest of THIS tab's session, but a genuinely fresh session/tab should
 *  always see the lock screen again. */
const SESSION_UNLOCK_KEY = "ai-os:unlocked";

type LockState = "locked" | "unlocking" | "unlocked";

/**
 * Gates the whole app behind a mocked, decorative lock screen — see
 * LoginScreen.tsx's doc comment for why. Wraps (rather than modifies)
 * whatever it's given as `children` (Desktop.tsx in practice): the real
 * desktop stays mounted underneath the lock screen the entire time, so it's
 * already fully ready — window store initialized, dock/command bar
 * interactive — the instant the unlock transition finishes, instead of
 * either delaying Desktop's mount behind the transition or popping it in
 * right as the blur clears.
 *
 * `children` may be a Server Component (Desktop.tsx deliberately is one —
 * see ARCHITECTURE.md) passed as a prop into this Client Component; that's
 * fine, and already this codebase's pattern for wrapping the desktop in
 * client-side chrome (see DesktopContextMenu.tsx wrapping `<Wallpaper />`).
 */
export function LoginGate({ children }: { children: ReactNode }) {
  // Deliberately starts "locked" on every render pass, server and client
  // alike, so hydration never mismatches. See the layout effect below for
  // how an already-unlocked session skips the lock screen without ever
  // actually painting it.
  const [lockState, setLockState] = useState<LockState>("locked");

  // useLayoutEffect, not useEffect: when this session was already unlocked,
  // this needs to commit "unlocked" before the browser's first paint, or a
  // reload within the same session would flash the lock screen for a frame
  // before disappearing again — exactly the "re-prompting" this persistence
  // is supposed to avoid. sessionStorage is read defensively because some
  // browser privacy modes throw on access instead of just returning null.
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_UNLOCK_KEY) === "true") {
        setLockState("unlocked");
      }
    } catch {
      // Storage unavailable for some reason — fall back to showing the lock
      // screen, same as a genuinely fresh session.
    }
  }, []);

  // "Skip the lock screen": once the saved preference has loaded, go straight in.
  const instantUnlock = usePreferences((s) => s.instantUnlock);
  useEffect(() => {
    if (instantUnlock && lockState === "locked") handleExitComplete();
  }, [instantUnlock, lockState]);

  function handleUnlock() {
    setLockState((state) => (state === "locked" ? "unlocking" : state));
  }

  function handleExitComplete() {
    setLockState("unlocked");
    try {
      sessionStorage.setItem(SESSION_UNLOCK_KEY, "true");
    } catch {
      // Nothing to fall back to here — worst case, this tab just shows the
      // lock screen again next reload instead of staying unlocked.
    }
  }

  return (
    <>
      {children}
      {lockState !== "unlocked" && (
        <LoginScreen
          isUnlocking={lockState === "unlocking"}
          onUnlock={handleUnlock}
          onExitComplete={handleExitComplete}
        />
      )}
    </>
  );
}
