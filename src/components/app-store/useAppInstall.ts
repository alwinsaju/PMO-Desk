"use client";

import { create } from "zustand";
import { INSTALLING_MS, installLabel, isDemoApp } from "./installFlow";
import type { AppListing } from "./types";

// Shared by every Install button (a card, the hero, the detail sheet), so they all show
// "Installing…" together while one install runs.
const useInstallingStore = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));

function setInstalling(id: string, on: boolean) {
  useInstallingStore.setState((s) => {
    const ids = { ...s.ids };
    if (on) ids[id] = true;
    else delete ids[id];
    return { ids };
  });
}

/** Label, busy flag and click handler of one app's Install / Open button. */
export function useAppInstall(
  app: Pick<AppListing, "id" | "url">,
  isInstalled: boolean,
  onPrimaryAction: () => void,
) {
  const installing = useInstallingStore((s) => Boolean(s.ids[app.id]));

  function start() {
    if (installing) return;
    if (isInstalled) {
      onPrimaryAction();
      return;
    }
    setInstalling(app.id, true);
    // Not cancelled on unmount: leaving the tab mid-install still completes it.
    window.setTimeout(() => {
      onPrimaryAction();
      setInstalling(app.id, false);
    }, INSTALLING_MS);
  }

  return {
    installing,
    label: installLabel(installing, isInstalled, isDemoApp(app)),
    start,
  };
}
