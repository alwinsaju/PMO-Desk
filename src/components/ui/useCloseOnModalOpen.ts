"use client";

import { useEffect, useRef } from "react";
import { onModalOpened } from "./modalEvents";

/** Calls `close` whenever a modal dialog opens. Tooltips and popovers use this so a
 *  tooltip that was showing when the dialog opened does not stay on top of it. Overlays
 *  opened after the dialog (e.g. a tooltip inside it) are not affected. */
export function useCloseOnModalOpen(close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => onModalOpened(() => closeRef.current()), []);
}
