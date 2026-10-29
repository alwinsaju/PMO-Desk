// Run with `pnpm test`. The dock hides itself after a grace period and comes back on
// hover; menus, keyboard focus and drags keep it up.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HIDE_DELAY_MS,
  INTRO_MS,
  createDockAutoHide,
  keepsDockOpen,
} from "./dockAutoHide.ts";

function harness(outside = { menuOpen: false, dragging: false }) {
  let now = 0;
  let pending = [];
  let nextId = 1;
  const states = [];
  const facts = { ...outside };
  const ctl = createDockAutoHide({
    onChange: (shown) => states.push(shown),
    outside: () => facts,
    setTimer: (run, ms) => {
      const entry = { id: nextId++, at: now + ms, run };
      pending.push(entry);
      return entry.id;
    },
    clearTimer: (id) => {
      pending = pending.filter((e) => e.id !== id);
    },
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = pending.filter((e) => e.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      pending = pending.filter((e) => e !== due);
      now = due.at;
      due.run();
    }
    now = until;
  };
  return { ctl, states, facts, advance };
}

describe("what keeps the dock up", () => {
  it("is any one of pointer, keyboard focus, an open menu or a drag", () => {
    const none = {
      pointerInside: false,
      focusInside: false,
      menuOpen: false,
      dragging: false,
    };
    assert.equal(keepsDockOpen(none), false);
    for (const key of Object.keys(none)) {
      assert.equal(keepsDockOpen({ ...none, [key]: true }), true, key);
    }
  });
});

describe("the dock's auto-hide", () => {
  it("hides after the intro when nothing is on it", () => {
    const { ctl, states, advance } = harness();
    ctl.start();
    advance(INTRO_MS - 1);
    assert.deepEqual(states, []);
    advance(1);
    assert.deepEqual(states, [false]);
  });

  it("comes back when the pointer arrives and hides after the grace period when it leaves", () => {
    const { ctl, states, advance } = harness();
    ctl.start();
    advance(INTRO_MS);
    ctl.pointer(true);
    assert.deepEqual(states, [false, true]);
    advance(10_000);
    assert.deepEqual(states, [false, true]);
    ctl.pointer(false);
    advance(HIDE_DELAY_MS - 1);
    assert.deepEqual(states, [false, true]);
    advance(1);
    assert.deepEqual(states, [false, true, false]);
  });

  it("does not hide when the pointer comes back within the grace period", () => {
    const { ctl, states, advance } = harness();
    ctl.pointer(true);
    ctl.pointer(false);
    advance(HIDE_DELAY_MS - 50);
    ctl.pointer(true);
    advance(5_000);
    assert.deepEqual(states, []);
  });

  it("waits while a menu is open or a tile is dragged, then hides", () => {
    const { ctl, states, facts, advance } = harness();
    ctl.pointer(true);
    facts.menuOpen = true;
    ctl.pointer(false);
    advance(HIDE_DELAY_MS * 4);
    assert.deepEqual(states, []);
    facts.menuOpen = false;
    facts.dragging = true;
    advance(HIDE_DELAY_MS);
    assert.deepEqual(states, []);
    facts.dragging = false;
    advance(HIDE_DELAY_MS);
    assert.deepEqual(states, [false]);
  });

  it("stays up while keyboard focus is inside, even with the pointer gone", () => {
    const { ctl, states, advance } = harness();
    ctl.focus(true);
    ctl.pointer(true);
    ctl.pointer(false);
    advance(HIDE_DELAY_MS * 3);
    assert.deepEqual(states, []);
    ctl.focus(false);
    advance(HIDE_DELAY_MS);
    assert.deepEqual(states, [false]);
  });

  it("stops its timer", () => {
    const { ctl, states, advance } = harness();
    ctl.start();
    ctl.stop();
    advance(INTRO_MS * 2);
    assert.deepEqual(states, []);
  });
});
