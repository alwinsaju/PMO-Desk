"use client";

import { useSyncExternalStore } from "react";
import { getSaveStatus, subscribeSaveStatus, type SaveStatus } from "./saveStatus";

/** Whether the server has the latest of a UI state key (see persistedStorage.ts). */
export function useSaveStatus(key: string): SaveStatus {
  return useSyncExternalStore(
    (listener) => subscribeSaveStatus(key, listener),
    () => getSaveStatus(key),
    () => getSaveStatus(key),
  );
}
