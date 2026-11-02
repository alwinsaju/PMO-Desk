import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampToViewport,
  defaultWindowGeometry,
  fitRectToViewport,
  maximizedRect,
  windowTransform,
} from "./windowGeometry.ts";

test("windowTransform places a window with a GPU translate", () => {
  assert.equal(windowTransform({ x: 12, y: 88 }), "translate3d(12px, 88px, 0)");
  assert.equal(windowTransform({ x: -385, y: 0 }), "translate3d(-385px, 0px, 0)");
});

const config = {
  size: { width: 1120, height: 680 },
  minSize: { width: 360, height: 240 },
  cascadeOffset: 24,
  cascadeWrap: 8,
  insets: { side: 12, top: 88, bottom: 96 },
};

function inside(g, vp) {
  const { insets } = config;
  assert.ok(g.position.x >= insets.side, "left edge");
  assert.ok(g.position.y >= insets.top, "below the dock");
  assert.ok(g.position.x + g.size.width <= vp.width - insets.side + 0.5, "right edge");
  assert.ok(
    g.position.y + g.size.height <= vp.height - insets.bottom + 0.5,
    "above the bar",
  );
}

test("every app gets the same default size on a roomy screen", () => {
  const g = defaultWindowGeometry(0, { width: 1920, height: 1080 }, config);
  assert.deepEqual(g.size, { width: 1120, height: 680 });
});

test("the cascade steps by the configured offset and wraps", () => {
  const vp = { width: 1920, height: 1080 };
  const a = defaultWindowGeometry(0, vp, config);
  const b = defaultWindowGeometry(1, vp, config);
  assert.equal(b.position.x - a.position.x, 24);
  assert.equal(b.position.y - a.position.y, 24);
  assert.deepEqual(defaultWindowGeometry(8, vp, config), a);
});

test("a window is shrunk to fit a small viewport but never below the minimum", () => {
  const phone = { width: 390, height: 700 };
  const g = defaultWindowGeometry(0, phone, config);
  assert.equal(g.size.width, 390 - 24);
  assert.ok(g.size.height <= 700 - 88 - 96 || g.size.height === 240);
  const tiny = defaultWindowGeometry(0, { width: 200, height: 200 }, config);
  assert.deepEqual(tiny.size, { width: 360, height: 240 });
});

test("every cascade position stays inside the keep-clear insets", () => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
  ]) {
    for (let i = 0; i < 20; i++) inside(defaultWindowGeometry(i, vp, config), vp);
  }
});

test("without a viewport (server render) nothing is clamped", () => {
  const g = defaultWindowGeometry(2, null, config);
  assert.deepEqual(g.size, { width: 1120, height: 680 });
  assert.deepEqual(g.position, { x: 12 + 48, y: 88 + 48 });
});

test("at the app minimum 1024x720 the default window fits entirely on screen", () => {
  const vp = { width: 1024, height: 720 };
  const g = defaultWindowGeometry(0, vp, config);
  assert.deepEqual(g.size, { width: 1000, height: 720 - 88 - 96 });
  inside(g, vp);
});

const clampCfg = { titlebarHeight: 54, minVisibleX: 80, bottomReserve: 84 };
const vp = { width: 1280, height: 720 };
const rect = (x, y, width = 600, height = 400) => ({ x, y, width, height });

test("clampToViewport leaves a reachable window alone", () => {
  assert.deepEqual(clampToViewport(rect(100, 100), vp, clampCfg), rect(100, 100));
});

test("clampToViewport never lets the title bar go above y=0", () => {
  assert.equal(clampToViewport(rect(100, -50), vp, clampCfg).y, 0);
});

test("clampToViewport keeps 80px of the title bar on screen on either side", () => {
  assert.equal(clampToViewport(rect(-900, 100), vp, clampCfg).x, 80 - 600);
  assert.equal(clampToViewport(rect(5000, 100), vp, clampCfg).x, 1280 - 80);
});

test("clampToViewport keeps the title bar above the command bar", () => {
  const g = clampToViewport(rect(100, 5000), vp, clampCfg);
  assert.equal(g.y, 720 - 84 - 54);
});

test("clampToViewport copes with windows narrower than the reach and tiny viewports", () => {
  const g = clampToViewport(rect(-500, 100, 50, 100), vp, clampCfg);
  assert.equal(g.x, 50 - 50);
  const tiny = clampToViewport(rect(900, 900), { width: 60, height: 100 }, clampCfg);
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y));
  assert.equal(tiny.y, 0);
});

const fitCfg = { ...clampCfg, insets: config.insets };
const min = { width: 360, height: 240 };

test("fitRectToViewport shrinks an oversized window to the keep-clear area", () => {
  const g = fitRectToViewport(
    rect(0, 0, 1120, 680),
    { width: 1024, height: 720 },
    fitCfg,
    min,
  );
  assert.equal(g.width, 1000);
  assert.equal(g.height, 720 - 88 - 96);
});

test("fitRectToViewport never shrinks below the window's minimum", () => {
  const g = fitRectToViewport(
    rect(0, 0, 1120, 680),
    { width: 200, height: 200 },
    fitCfg,
    min,
  );
  assert.equal(g.width, 360);
  assert.equal(g.height, 240);
});

test("fitRectToViewport also pulls a stranded window back on screen", () => {
  const g = fitRectToViewport(rect(2000, 900), { width: 1024, height: 720 }, fitCfg, min);
  assert.equal(g.x, 1024 - 80);
  assert.equal(g.y, 720 - 84 - 54);
});

test("fitRectToViewport returns the same object when nothing changes", () => {
  const r = rect(100, 100);
  assert.equal(fitRectToViewport(r, vp, fitCfg, min), r);
});

test("maximizedRect fills the viewport inside the keep-clear insets", () => {
  assert.deepEqual(maximizedRect({ width: 1280, height: 720 }, config.insets), {
    x: 12,
    y: 88,
    width: 1256,
    height: 720 - 88 - 96,
  });
});

test("maximizedRect never collapses on a tiny viewport", () => {
  const r = maximizedRect({ width: 10, height: 10 }, config.insets);
  assert.ok(r.width >= 0 && r.height >= 0);
});
