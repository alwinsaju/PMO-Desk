// Run with `pnpm test`. "Show desktop" and "Tidy windows": the pure parts of the two store actions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPlacements,
  applyTidy,
  hasVisibleWindow,
  minimizeAll,
  tidyUpdates,
} from "./windowArrange.ts";

const config = {
  size: { width: 1120, height: 680 },
  minSize: { width: 360, height: 240 },
  cascadeOffset: 24,
  cascadeWrap: 8,
  insets: { side: 12, top: 88, bottom: 96 },
};
const fit = {
  titlebarHeight: 40,
  minVisibleX: 80,
  bottomReserve: 80,
  insets: config.insets,
};
const roomy = { width: 1920, height: 1080 };

const win = (id, over = {}) => ({
  id,
  appId: "notes",
  zIndex: 100,
  isMinimized: false,
  isMaximized: false,
  isFocused: false,
  position: { x: 5, y: 5 },
  size: { width: 500, height: 400 },
  ...over,
});
const record = (...list) => Object.fromEntries(list.map((w) => [w.id, w]));

describe("minimizeAll (Show desktop)", () => {
  it("minimises every window and focuses none, in one pass", () => {
    const before = record(
      win("a", { isFocused: false, zIndex: 100 }),
      win("b", { isFocused: true, zIndex: 101 }),
      win("c", { isMinimized: true, zIndex: 102 }),
    );
    const after = minimizeAll(before);
    for (const w of Object.values(after)) {
      assert.equal(w.isMinimized, true);
      assert.equal(w.isFocused, false);
    }
    // Nothing else about a window changes (position, size, stacking).
    assert.equal(after.a.zIndex, 100);
    assert.deepEqual(after.b.position, before.b.position);
  });

  it("keeps the object of a window that was already minimised and unfocused", () => {
    const parked = win("c", { isMinimized: true });
    const after = minimizeAll(record(win("a"), parked));
    assert.equal(after.c, parked);
  });

  it("gives back the same record when there is nothing to minimise", () => {
    const none = record(win("a", { isMinimized: true }));
    assert.equal(minimizeAll(none), none);
    const empty = {};
    assert.equal(minimizeAll(empty), empty);
  });

  it("does not change the record it was given", () => {
    const before = record(win("a"), win("b", { isFocused: true }));
    minimizeAll(before);
    assert.equal(before.a.isMinimized, false);
    assert.equal(before.b.isFocused, true);
  });

  it("hasVisibleWindow is true until every window is minimised", () => {
    assert.equal(hasVisibleWindow({}), false);
    assert.equal(
      hasVisibleWindow(record(win("a"), win("b", { isMinimized: true }))),
      true,
    );
    assert.equal(hasVisibleWindow(minimizeAll(record(win("a"), win("b")))), false);
  });
});

const rectOf = (u) => ({ ...u.geometry.position, ...u.geometry.size });
const overlap = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const area = (view) => ({
  x: config.insets.side,
  y: config.insets.top,
  width: view.width - config.insets.side * 2,
  height: view.height - config.insets.top - config.insets.bottom,
});
const inside = (r, a) =>
  r.x >= a.x &&
  r.y >= a.y &&
  r.x + r.width <= a.x + a.width &&
  r.y + r.height <= a.y + a.height;
const stacked = (n, over = () => ({})) =>
  record(
    ...Array.from({ length: n }, (_, i) => win(`w${i}`, { zIndex: 100 + i, ...over(i) })),
  );

describe("tidyUpdates (Tidy windows)", () => {
  it("returns the windows in stacking order, bottom first", () => {
    const windows = record(
      win("top", { zIndex: 103 }),
      win("bottom", { zIndex: 101 }),
      win("mid", { zIndex: 102 }),
    );
    assert.deepEqual(
      tidyUpdates(windows, roomy, config, fit).map((u) => u.id),
      ["bottom", "mid", "top"],
    );
  });

  it("puts a single window at its default size, centred", () => {
    const [u] = tidyUpdates(stacked(1), roomy, config, fit);
    assert.deepEqual(u.geometry.size, config.size);
    assert.equal(
      u.geometry.position.x,
      Math.round((roomy.width - config.size.width) / 2),
    );
  });

  it("uses the per-app default size for a single window", () => {
    const windows = record(win("d", { appId: "dashboard" }));
    const [d] = tidyUpdates(windows, roomy, config, fit);
    assert.deepEqual(d.geometry.size, { width: 1240, height: 740 });
  });

  it("puts two windows side by side across the usable area", () => {
    const [a, b] = tidyUpdates(stacked(2), roomy, config, fit).map(rectOf);
    const full = area(roomy);
    assert.equal(a.x, full.x);
    assert.equal(a.y, full.y);
    assert.equal(a.height, full.height);
    assert.equal(b.height, full.height);
    assert.ok(a.x + a.width < b.x, "a gap between the two");
    assert.equal(b.x + b.width, full.x + full.width);
    assert.equal(overlap(a, b), false);
  });

  it("tiles four windows in a 2x2 grid with no overlap, in stacking order", () => {
    const out = tidyUpdates(stacked(4), roomy, config, fit).map(rectOf);
    const full = area(roomy);
    for (const r of out) assert.ok(inside(r, full));
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) assert.equal(overlap(out[i], out[j]), false);
    assert.equal(out[0].y, out[1].y);
    assert.equal(out[2].y, out[3].y);
    assert.ok(out[2].y > out[0].y + out[0].height - 1);
    assert.ok(out[0].x < out[1].x && out[2].x < out[3].x);
  });

  it("tiles three windows as two on top and one across the bottom", () => {
    const out = tidyUpdates(stacked(3), roomy, config, fit).map(rectOf);
    const full = area(roomy);
    for (const r of out) assert.ok(inside(r, full));
    assert.equal(overlap(out[0], out[1]), false);
    assert.equal(overlap(out[0], out[2]), false);
    assert.equal(overlap(out[1], out[2]), false);
    assert.equal(out[2].width, full.width);
    assert.equal(out[2].x, full.x);
  });

  it("clearly separates three windows: no two start within 100 px of each other", () => {
    const out = tidyUpdates(stacked(3), roomy, config, fit).map(rectOf);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const far =
          Math.abs(out[i].x - out[j].x) >= 100 || Math.abs(out[i].y - out[j].y) >= 100;
        assert.ok(far, `windows ${i} and ${j} are almost on top of each other`);
      }
  });

  it("keeps tiles inside a narrow viewport (the QA case: 1014 px wide)", () => {
    const view = { width: 1014, height: 768 };
    const full = area(view);
    for (const count of [2, 3, 4]) {
      for (const u of tidyUpdates(stacked(count), view, config, fit)) {
        assert.ok(
          inside(rectOf(u), full),
          `${count} windows: ${JSON.stringify(rectOf(u))}`,
        );
      }
    }
  });

  it("cascades more than four windows with a bigger step than a normal open", () => {
    const out = tidyUpdates(stacked(5), roomy, config, fit);
    const [a, b, c] = out.map((u) => u.geometry.position);
    assert.equal(b.x - a.x, 48);
    assert.equal(c.x - b.x, 48);
    assert.equal(b.y - a.y, 48);
  });

  it("ignores any saved rectangle (the window's own position and size)", () => {
    const windows = record(
      win("a", { position: { x: 900, y: 900 }, size: { width: 400, height: 300 } }),
    );
    const [u] = tidyUpdates(windows, roomy, config, fit);
    assert.deepEqual(u.geometry.size, config.size);
  });

  it("leaves minimised windows out", () => {
    const windows = record(win("a"), win("b", { isMinimized: true }));
    assert.deepEqual(
      tidyUpdates(windows, roomy, config, fit).map((u) => u.id),
      ["a"],
    );
  });

  it("never sizes a window below its own minimum", () => {
    const windows = record(win("a", { minSize: { width: 1500, height: 900 } }));
    const [u] = tidyUpdates(windows, { width: 1000, height: 700 }, config, fit);
    assert.ok(u.geometry.size.width >= 1500);
    assert.ok(u.geometry.size.height >= 900);
  });

  it("never sizes a tiled window below its own minimum", () => {
    const windows = stacked(2, (i) => ({
      minSize: i === 0 ? { width: 900, height: 600 } : undefined,
    }));
    const view = { width: 1000, height: 800 };
    const [a, b] = tidyUpdates(windows, view, config, fit);
    assert.ok(a.geometry.size.width >= 900 && a.geometry.size.height >= 600);
    assert.ok(b.geometry.size.width >= config.minSize.width);
  });

  it("wraps the cascade after cascadeWrap windows instead of walking off the screen", () => {
    const list = Array.from({ length: 10 }, (_, i) => win(`w${i}`, { zIndex: 100 + i }));
    const out = tidyUpdates(record(...list), roomy, config, fit);
    assert.deepEqual(out[8].geometry.position, out[0].geometry.position);
  });

  it("keeps every window inside the screen on a small viewport", () => {
    const list = Array.from({ length: 4 }, (_, i) => win(`w${i}`, { zIndex: 100 + i }));
    const view = { width: 900, height: 600 };
    for (const { geometry } of tidyUpdates(record(...list), view, config, fit)) {
      assert.ok(geometry.position.x >= 0 && geometry.position.y >= 0);
    }
  });
});

describe("applyTidy", () => {
  it("moves and resizes the windows, and un-maximises them", () => {
    const windows = record(
      win("a", { zIndex: 100 }),
      win("b", {
        zIndex: 101,
        isMaximized: true,
        isFocused: true,
        restoreBounds: { position: { x: 1, y: 1 }, size: { width: 400, height: 300 } },
      }),
    );
    const out = applyTidy(windows, tidyUpdates(windows, roomy, config, fit));
    assert.equal(out.b.isMaximized, false);
    assert.equal(out.b.restoreBounds, undefined);
    assert.deepEqual(out.a.position, { x: 12, y: 88 });
    assert.ok(out.a.size.width < config.size.width, "tiled beside the other window");
    // Stacking and focus are untouched.
    assert.equal(out.b.zIndex, 101);
    assert.equal(out.b.isFocused, true);
  });

  it("returns the same record when every window is already tidy", () => {
    const windows = record(win("a"));
    const once = applyTidy(windows, tidyUpdates(windows, roomy, config, fit));
    assert.equal(applyTidy(once, tidyUpdates(once, roomy, config, fit)), once);
  });

  it("does not touch a minimised window", () => {
    const parked = win("p", { isMinimized: true });
    const windows = record(win("a"), parked);
    const out = applyTidy(windows, tidyUpdates(windows, roomy, config, fit));
    assert.equal(out.p, parked);
  });
});

describe("applyPlacements (restoring a saved layout)", () => {
  const geo = (x) => ({ position: { x, y: 50 }, size: { width: 700, height: 500 } });

  it("places each window, shows it, stacks them in the given order and focuses the last", () => {
    const windows = record(
      win("a", { zIndex: 100, isFocused: true }),
      win("b", { zIndex: 101, isMinimized: true }),
      win("c", { zIndex: 102, isMaximized: true, restoreBounds: { x: 1 } }),
    );
    const out = applyPlacements(
      windows,
      110,
      [
        { id: "c", geometry: geo(10) },
        { id: "a", geometry: geo(20) },
        { id: "b", geometry: geo(30) },
      ],
      false,
    );
    assert.equal(out.nextZIndex, 113);
    assert.deepEqual(
      ["c", "a", "b"].map((id) => out.windows[id].zIndex),
      [110, 111, 112],
    );
    assert.deepEqual(out.windows.a.position, { x: 20, y: 50 });
    assert.deepEqual(out.windows.a.size, { width: 700, height: 500 });
    assert.equal(out.windows.b.isMinimized, false);
    assert.equal(out.windows.c.isMaximized, false);
    assert.equal(out.windows.c.restoreBounds, undefined);
    assert.deepEqual(
      ["a", "b", "c"].map((id) => out.windows[id].isFocused),
      [false, true, false],
    );
  });

  it("leaves a window the layout lacks open and unmoved (only its focus goes)", () => {
    const other = win("o", { zIndex: 105, isFocused: true });
    const parked = win("p", { isMinimized: true });
    const out = applyPlacements(
      record(win("a"), other, parked),
      200,
      [{ id: "a", geometry: geo(0) }],
      false,
    );
    assert.equal(out.windows.o.isMinimized, false);
    assert.equal(out.windows.o.isFocused, false);
    assert.equal(out.windows.o.zIndex, 105);
    assert.deepEqual(out.windows.o.position, other.position);
    assert.equal(out.windows.p, parked);
    assert.equal(Object.keys(out.windows).length, 3);
  });

  it("minimises (never closes) the other windows only when asked", () => {
    const windows = record(win("a"), win("o"), win("p", { isMinimized: true }));
    const out = applyPlacements(windows, 200, [{ id: "a", geometry: geo(0) }], true);
    assert.equal(out.windows.o.isMinimized, true);
    assert.equal(out.windows.o.isFocused, false);
    assert.equal(out.windows.p, windows.p);
    assert.deepEqual(Object.keys(out.windows).sort(), ["a", "o", "p"]);
  });

  it("skips unknown ids and repeats, and returns the same record when nothing is placed", () => {
    const windows = record(win("a", { isFocused: true }));
    assert.equal(
      applyPlacements(windows, 200, [{ id: "zzz", geometry: geo(0) }], true).windows,
      windows,
    );
    const out = applyPlacements(
      windows,
      200,
      [
        { id: "a", geometry: geo(1) },
        { id: "a", geometry: geo(2) },
        { id: "zzz", geometry: geo(3) },
      ],
      false,
    );
    assert.equal(out.windows.a.position.x, 1);
    assert.equal(out.nextZIndex, 201);
  });

  it("does not change the record it was given", () => {
    const windows = record(win("a"), win("o"));
    const copy = JSON.parse(JSON.stringify(windows));
    applyPlacements(windows, 200, [{ id: "a", geometry: geo(5) }], true);
    assert.deepEqual(windows, copy);
  });
});
