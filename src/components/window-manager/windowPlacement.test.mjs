import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_DEFAULT_SIZES,
  pristineUpdates,
  rectsToRemember,
  startingGeometry,
} from "./windowPlacement.ts";

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

const start = (over) =>
  startingGeometry({
    appId: "notes",
    openCount: 0,
    viewport: roomy,
    config,
    fit,
    remembered: {},
    sameAppOpen: false,
    ...over,
  });

describe("startingGeometry", () => {
  it("uses the shared size for an app without its own", () => {
    assert.deepEqual(start({ appId: "notes" }).size, { width: 1120, height: 680 });
  });

  it("gives the wide apps their own default size", () => {
    assert.deepEqual(start({ appId: "dashboard" }).size, APP_DEFAULT_SIZES.dashboard);
  });

  it("shrinks an app's own size to a small screen", () => {
    const g = start({ appId: "staff", viewport: { width: 900, height: 700 } });
    assert.ok(g.size.width <= 900 - 24);
    assert.ok(g.size.height <= 700 - 88 - 96);
  });

  it("restores the remembered rectangle", () => {
    const rect = { x: 200, y: 150, width: 800, height: 500 };
    const g = start({ appId: "staff", remembered: { staff: rect } });
    assert.deepEqual(g, {
      position: { x: 200, y: 150 },
      size: { width: 800, height: 500 },
    });
  });

  it("pulls a remembered window back onto a smaller screen", () => {
    const rect = { x: 1700, y: 900, width: 1200, height: 900 };
    const g = start({
      appId: "staff",
      viewport: { width: 1000, height: 700 },
      remembered: { staff: rect },
    });
    assert.ok(g.size.width <= 1000 - 24);
    assert.ok(g.position.x + 80 <= 1000, "title bar still reachable");
    assert.ok(g.position.y <= 700 - 80 - 40, "above the command bar");
  });

  it("cascades instead of landing on top of an open window of the same app", () => {
    const rect = { x: 200, y: 150, width: 800, height: 500 };
    const g = start({
      appId: "notes",
      remembered: { notes: rect },
      sameAppOpen: true,
      openCount: 1,
    });
    assert.notDeepEqual(g.position, { x: 200, y: 150 });
    assert.deepEqual(g.size, { width: 1120, height: 680 });
  });

  it("never restores a web app's rectangle", () => {
    const rect = { x: 200, y: 150, width: 800, height: 500 };
    assert.deepEqual(start({ appId: "web-app", remembered: { "web-app": rect } }).size, {
      width: 1120,
      height: 680,
    });
  });
});

describe("pristineUpdates", () => {
  const rect = { x: 200, y: 150, width: 800, height: 500 };
  const opened = { position: { x: 12, y: 88 }, size: { width: 1280, height: 760 } };
  const win = (over = {}) => ({
    appId: "staff",
    position: opened.position,
    size: opened.size,
    isMaximized: false,
    isMinimized: false,
    ...over,
  });
  const base = {
    viewport: roomy,
    config,
    fit,
    remembered: { staff: rect },
  };

  it("moves a window nobody has touched to its remembered place", () => {
    const updates = pristineUpdates({
      ...base,
      windows: { a: win() },
      pristine: new Map([["a", opened]]),
    });
    assert.deepEqual(updates, [
      {
        id: "a",
        geometry: { position: { x: 200, y: 150 }, size: { width: 800, height: 500 } },
      },
    ]);
  });

  it("leaves alone a window that was moved, resized, maximised or is not remembered", () => {
    const pristine = new Map([["a", opened]]);
    for (const w of [
      win({ position: { x: 5, y: 5 } }),
      win({ size: { width: 900, height: 600 } }),
      win({ isMaximized: true }),
      win({ appId: "web-app" }),
    ]) {
      assert.deepEqual(pristineUpdates({ ...base, windows: { a: w }, pristine }), []);
    }
    assert.deepEqual(
      pristineUpdates({ ...base, remembered: {}, windows: { a: win() }, pristine }),
      [],
    );
  });

  it("does not stack a second window of the same app on top of the first", () => {
    const pristine = new Map([
      ["a", opened],
      ["b", opened],
    ]);
    const updates = pristineUpdates({
      ...base,
      windows: { a: win(), b: win() },
      pristine,
    });
    assert.equal(updates.length, 1);
  });

  it("ignores windows that have since closed", () => {
    assert.deepEqual(
      pristineUpdates({ ...base, windows: {}, pristine: new Map([["gone", opened]]) }),
      [],
    );
  });
});

describe("rectsToRemember", () => {
  const win = (over = {}) => ({
    appId: "staff",
    position: { x: 1, y: 2 },
    size: { width: 800, height: 500 },
    isMaximized: false,
    isMinimized: false,
    ...over,
  });

  it("reports a window that moved or resized", () => {
    const before = { a: win() };
    const after = { a: win({ position: { x: 5, y: 6 } }) };
    assert.deepEqual(rectsToRemember(before, after), [
      { appId: "staff", rect: { x: 5, y: 6, width: 800, height: 500 } },
    ]);
  });

  it("ignores untouched, brand-new, maximised, minimised and web-app windows", () => {
    const same = win();
    assert.deepEqual(rectsToRemember({ a: same }, { a: same }), []);
    assert.deepEqual(rectsToRemember({}, { a: win() }), []);
    const moved = { position: { x: 9, y: 9 } };
    assert.deepEqual(
      rectsToRemember({ a: win() }, { a: win({ ...moved, isMaximized: true }) }),
      [],
    );
    assert.deepEqual(
      rectsToRemember({ a: win() }, { a: win({ ...moved, isMinimized: true }) }),
      [],
    );
    assert.deepEqual(
      rectsToRemember({ a: win() }, { a: win({ ...moved, appId: "web-app" }) }),
      [],
    );
  });

  it("remembers the restored rectangle when a window comes back from maximised", () => {
    const before = { a: win({ isMaximized: true, position: { x: 12, y: 88 } }) };
    const after = { a: win({ position: { x: 300, y: 200 } }) };
    assert.equal(rectsToRemember(before, after)[0].rect.x, 300);
  });
});
