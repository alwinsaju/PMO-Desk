"use client";

import { createContext, useContext, useRef } from "react";
import { useStaffStore, type StaffState } from "@/lib/staff/staffStore";

/** The Staff tabs stay mounted while hidden. This says whether the tab around a component is the visible one. */
export const TabActiveContext = createContext(true);

/**
 * Reads the staff store like `useStaffStore`, but while the tab is hidden it keeps returning
 * the last value it showed. A big list changing in the Directory (removing 1000 people) then does
 * not re-render the hidden Shift roster, Offboarded and Insights tabs; they catch up when opened.
 */
export function useActiveStaff<T>(select: (state: StaffState) => T): T {
  const active = useContext(TabActiveContext);
  const held = useRef<{ value: T } | null>(null);
  return useStaffStore((state) => {
    if (active || held.current === null) held.current = { value: select(state) };
    return held.current.value;
  });
}
