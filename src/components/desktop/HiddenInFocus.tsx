"use client";

import type { ReactNode } from "react";
import { useFocusActive } from "@/lib/focusModeStore";

/** Hides what it wraps while focus mode is on (the dock). */
export function HiddenInFocus({ children }: { children: ReactNode }) {
  return useFocusActive() ? null : <>{children}</>;
}
