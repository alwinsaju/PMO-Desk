"use client";

import { useRemindersStore } from "@/components/apps/pmo-todo-app/remindersStore";
import { useTemplatesNav } from "@/components/apps/templates-app/templatesNavStore";
import { openOrFocusBuiltInApp } from "./launchBuiltInApp";

/** Dock menu > Recent: open (or raise) the app and ask it to show that item. The request
 *  waits in the nav store until the app consumes it, so it works for a window that is
 *  already open and for one that is only now opening. */
export function openRecentItem(appId: string, itemId: string): void {
  openOrFocusBuiltInApp(appId);
  if (appId === "pmo-todo") useRemindersStore.getState().requestOpen(itemId);
  else if (appId === "templates") useTemplatesNav.getState().requestOpen(itemId);
}
