"use client";

import { create } from "zustand";
import type { TimeOffStatus } from "@/lib/staff/types";

/** A request to show one part of Staff Management (e.g. the pending leave requests).
 *  StaffApp consumes it, whether the window was already open or has just been opened. */
export interface StaffOpenRequest {
  id: number;
  tab: "directory" | "shifts" | "timeoff" | "offboarded";
  /** The Time off status filter to apply with the "timeoff" tab. */
  timeOffStatus?: TimeOffStatus | "";
}

interface StaffNavState {
  openRequest: StaffOpenRequest | null;
  requestOpen: (request: Omit<StaffOpenRequest, "id">) => void;
  clearOpenRequest: (id: number) => void;
}

let counter = 0;

export const useStaffNav = create<StaffNavState>()((set) => ({
  openRequest: null,
  requestOpen: (request) => set({ openRequest: { ...request, id: ++counter } }),
  clearOpenRequest: (id) =>
    set((state) => (state.openRequest?.id === id ? { openRequest: null } : state)),
}));
