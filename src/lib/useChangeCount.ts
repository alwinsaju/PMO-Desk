"use client";

import { useState } from "react";

/**
 * A number that goes up each time `value` changes after the first render, 0 until then.
 * Use it as the `key` of a short-lived overlay (`anim-flash`) to flash a card whose
 * status just changed; there is no timer and no effect, and nothing flashes on mount.
 */
export function useChangeCount(value: unknown): number {
  const [seen, setSeen] = useState(value);
  const [count, setCount] = useState(0);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setCount(count + 1);
  }
  return count;
}
