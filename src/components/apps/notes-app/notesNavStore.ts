"use client";

import { create } from "zustand";

/** A request to show one note (Ctrl+K sends it when a note result is chosen).
 *  NotesApp consumes it, whether the window was already open or has just been opened. */
export interface NotesOpenRequest {
  id: number;
  noteId: string;
}

interface NotesNavState {
  openRequest: NotesOpenRequest | null;
  requestOpen: (noteId: string) => void;
  clearOpenRequest: (id: number) => void;
}

let counter = 0;

export const useNotesNav = create<NotesNavState>()((set) => ({
  openRequest: null,
  requestOpen: (noteId) => set({ openRequest: { noteId, id: ++counter } }),
  clearOpenRequest: (id) =>
    set((state) => (state.openRequest?.id === id ? { openRequest: null } : state)),
}));
