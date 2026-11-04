"use client";

import { useEffect } from "react";
import { fetchAudit, fetchInfo } from "@/components/apps/settings-app/platformApi";
import { openSettings } from "@/components/apps/settings-app/settingsNav";
import { runUpdateCheck } from "@/components/apps/settings-app/updateActions";
import { toast } from "@/lib/notifications/toastStore";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { setAppVersionKnown } from "@/lib/platform/reportError";
import { releasesToShow } from "@/lib/platform/releaseNotes";
import { buildRecap, recapMessage } from "@/lib/platform/sinceRecap";
import { useTour } from "@/lib/platform/tourStore";
import { checkDue } from "@/lib/platform/updateCheck";

/**
 * Renders nothing. After start-up it offers the tour to a new person, or shows "what's new" once after an
 * update, and (only when the person turned it on) looks for a newer release about once a day. It also offers a "Since you last opened" recap of the PMO activity log.
 */
export function PlatformBackground() {
  useEffect(() => {
    let stopped = false;
    let announced = false;

    async function announce() {
      if (announced) return;
      announced = true;
      const reply = await fetchInfo();
      if (stopped || !reply.ok) return;
      setAppVersionKnown(reply.version);
      const prefs = usePlatformPrefs.getState();
      const seen = prefs.lastSeenVersion;
      if (seen === reply.version) return;
      prefs.update((p) => ({ ...p, lastSeenVersion: reply.version }));
      if (seen === "" && !prefs.tourDone) {
        toast({
          key: "welcome",
          message: `Welcome to PMO Desk ${reply.version}. Want a one-minute tour?`,
          durationMs: 25_000,
          action: { label: "Take the tour", run: () => useTour.getState().start() },
        });
      } else if (releasesToShow(seen, reply.version).length > 0) {
        toast({
          key: "whats-new",
          message: `PMO Desk is now ${reply.version}. See what's new.`,
          durationMs: 25_000,
          action: { label: "What's new", run: () => openSettings("about") },
        });
      }
    }

    async function updates() {
      const { updates: u } = usePlatformPrefs.getState();
      if (!u.manifestUrl || !checkDue(u.enabled, u.lastCheckedAt, new Date())) return;
      const outcome = await runUpdateCheck();
      if (stopped || !outcome.ok || !outcome.available) return;
      toast({
        key: "update-available",
        message: `PMO Desk ${outcome.version} is available.`,
        durationMs: 20_000,
        action: { label: "View", run: () => openSettings("about") },
      });
    }

    /**
     * "Since you last opened": counts the audit lines newer than the saved time, offers them in a toast, and only
     * then saves this launch as the new "last opened" time. The first run (no saved time) shows nothing.
     * If the log cannot be read the saved time is left alone, so the recap is not lost.
     */
    async function recap() {
      const before = usePlatformPrefs.getState().lastOpenedAt;
      const stamp = new Date().toISOString();
      if (!before) {
        usePlatformPrefs.getState().update((p) => ({ ...p, lastOpenedAt: stamp }));
        return;
      }
      const reply = await fetchAudit();
      if (stopped || !reply.ok) return;
      const found = buildRecap(reply.entries, before);
      usePlatformPrefs.getState().update((p) => ({ ...p, lastOpenedAt: stamp }));
      if (!found) return;
      toast({
        key: "since-last-opened",
        message: recapMessage(found),
        durationMs: 30_000,
        action: {
          label: "View",
          run: () => openSettings("activity", { activitySince: found.since }),
        },
      });
    }

    const timer = setInterval(() => {
      if (stopped || !usePlatformPrefs.persist.hasHydrated()) return;
      clearInterval(timer);
      setTimeout(() => {
        void announce().then(() => {
          void recap();
          return updates();
        });
      }, 8_000);
    }, 1_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return null;
}
