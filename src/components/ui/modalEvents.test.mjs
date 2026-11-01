// Run with `pnpm test`. The "a modal opened" signal that closes open tooltips and popovers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { announceModalOpened, onModalOpened } from "./modalEvents.ts";

describe("modal opened signal", () => {
  it("tells every subscriber when a modal opens", () => {
    let a = 0;
    let b = 0;
    const offA = onModalOpened(() => a++);
    const offB = onModalOpened(() => b++);
    announceModalOpened();
    announceModalOpened();
    assert.deepEqual([a, b], [2, 2]);
    offA();
    offB();
  });

  it("stops telling a subscriber after it unsubscribes", () => {
    let calls = 0;
    const off = onModalOpened(() => calls++);
    announceModalOpened();
    off();
    announceModalOpened();
    assert.equal(calls, 1);
  });

  it("lets a subscriber unsubscribe from inside its own callback", () => {
    let calls = 0;
    const off = onModalOpened(() => {
      calls++;
      off();
    });
    const other = onModalOpened(() => calls++);
    announceModalOpened();
    announceModalOpened();
    assert.equal(calls, 3);
    other();
  });
});
