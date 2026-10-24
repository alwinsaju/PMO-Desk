import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultWindowGeometry } from "./windowGeometry.ts";

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
