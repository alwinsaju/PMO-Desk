"use client";

import { create } from "zustand";
import { toggleFlag } from "@/lib/pmo/cardView";

interface ExpandedCardsState {
  /** To-dos whose action items are shown. Held here, not in the card, so a card
   *  keeps its state when the list re-sorts or the tab is left and come back to. */
  open: Record<string, true>;
  toggle: (todoId: string) => void;
}

export const useExpandedCards = create<ExpandedCardsState>()((set) => ({
  open: {},
  toggle: (todoId) => set((state) => ({ open: toggleFlag(state.open, todoId) })),
}));
