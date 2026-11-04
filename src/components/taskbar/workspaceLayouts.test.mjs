// Run with `pnpm test`. Named workspace layouts: names, the list, capture, and the restore plan.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureLayoutWindows,
  checkLayoutName,
  deleteWorkspaceLayout,
  describeRestore,
  planLayoutRestore,
  renameWorkspaceLayout,
  saveWorkspaceLayout,
} from "./workspaceLayouts.ts";
import {
  MAX_LAYOUT_NAME,
  MAX_LAYOUT_WINDOWS,
  MAX_WORKSPACE_LAYOUTS,
} from "../../lib/preferences/schema.ts";

const rect = (x = 10, y = 20, width = 800, height = 500) => ({ x, y, width, height });
const entry = (appId, r = rect()) => ({ appId, rect: r });
const layout = (name, windows = [entry("notes")]) => ({ name, windows });

describe("checkLayoutName", () => {
  const saved = [layout("Review"), layout("Morning")];

  it("trims and collapses spaces", () => {
    assert.deepEqual(checkLayoutName("  Weekly   report ", saved), {
      ok: true,
      name: "Weekly report",
    });
  });

  it("refuses an empty or too long name", () => {
    assert.equal(checkLayoutName("   ", saved).ok, false);
    assert.equal(checkLayoutName("", saved).ok, false);
    assert.equal(checkLayoutName(undefined, saved).ok, false);
    assert.equal(checkLayoutName("x".repeat(MAX_LAYOUT_NAME), saved).ok, true);
    assert.equal(checkLayoutName("x".repeat(MAX_LAYOUT_NAME + 1), saved).ok, false);
  });

  it("refuses a name already used, ignoring case and spacing", () => {
    assert.equal(checkLayoutName("review", saved).ok, false);
    assert.equal(checkLayoutName("  MORNING ", saved).ok, false);
  });

  it("lets the layout being renamed keep its name or change only its case", () => {
    assert.equal(checkLayoutName("Review", saved, "Review").ok, true);
    assert.equal(checkLayoutName("REVIEW", saved, "Review").ok, true);
    assert.equal(checkLayoutName("morning", saved, "Review").ok, false);
  });
});

describe("saving, renaming and deleting", () => {
  it("adds a layout at the end with the cleaned name", () => {
    const before = [layout("A")];
    const res = saveWorkspaceLayout(before, " B ", [entry("files"), entry("tasks")]);
    assert.equal(res.ok, true);
    assert.deepEqual(
      res.layouts.map((l) => l.name),
      ["A", "B"],
    );
    assert.equal(res.name, "B");
    assert.equal(res.layouts[1].windows.length, 2);
    assert.equal(before.length, 1, "the given list is not changed");
  });

  it("refuses to save nothing, a bad name, a repeated name, and a ninth layout", () => {
    assert.equal(saveWorkspaceLayout([], "A", []).ok, false);
    assert.equal(saveWorkspaceLayout([], "", [entry("notes")]).ok, false);
    assert.equal(saveWorkspaceLayout([layout("A")], "a", [entry("notes")]).ok, false);
    const full = Array.from({ length: MAX_WORKSPACE_LAYOUTS }, (_, i) => layout(`L${i}`));
    const res = saveWorkspaceLayout(full, "One more", [entry("notes")]);
    assert.equal(res.ok, false);
    assert.match(res.reason, /Delete one/);
  });

  it("never keeps more than the window limit", () => {
    const windows = Array.from({ length: MAX_LAYOUT_WINDOWS + 4 }, (_, i) =>
      entry(`a${i}`),
    );
    const res = saveWorkspaceLayout([], "Big", windows);
    assert.equal(res.layouts[0].windows.length, MAX_LAYOUT_WINDOWS);
    assert.equal(res.layouts[0].windows.at(-1).appId, `a${MAX_LAYOUT_WINDOWS + 3}`);
  });

  it("renames in place and keeps the order and windows", () => {
    const before = [layout("A"), layout("B", [entry("files")])];
    const res = renameWorkspaceLayout(before, "B", "  Bee ");
    assert.equal(res.ok, true);
    assert.deepEqual(
      res.layouts.map((l) => l.name),
      ["A", "Bee"],
    );
    assert.deepEqual(res.layouts[1].windows, [entry("files")]);
  });

  it("refuses a rename to a name in use, an empty name, or a layout that is gone", () => {
    const before = [layout("A"), layout("B")];
    assert.equal(renameWorkspaceLayout(before, "B", "a").ok, false);
    assert.equal(renameWorkspaceLayout(before, "B", "  ").ok, false);
    assert.equal(renameWorkspaceLayout(before, "Z", "Y").ok, false);
    assert.equal(renameWorkspaceLayout(before, "B", "b").ok, true);
  });

  it("deletes by name and leaves the rest", () => {
    const before = [layout("A"), layout("B")];
    assert.deepEqual(
      deleteWorkspaceLayout(before, "A").map((l) => l.name),
      ["B"],
    );
    assert.equal(deleteWorkspaceLayout(before, "nope").length, 2);
  });
});

describe("captureLayoutWindows", () => {
  const restorable = new Set(["notes", "files", "tasks", "dashboard"]);
  const win = (appId, zIndex, over = {}) => ({
    appId,
    zIndex,
    isMaximized: false,
    position: { x: zIndex, y: 2 },
    size: { width: 600, height: 400 },
    ...over,
  });
  const wins = (...list) => Object.fromEntries(list.map((w, i) => [`w${i}`, w]));

  it("lists each app once, bottom to top, with its window's rectangle", () => {
    const out = captureLayoutWindows(
      wins(win("tasks", 105), win("notes", 101), win("files", 103)),
      restorable,
    );
    assert.deepEqual(
      out.map((e) => e.appId),
      ["notes", "files", "tasks"],
    );
    assert.deepEqual(out[0].rect, { x: 101, y: 2, width: 600, height: 400 });
  });

  it("uses the topmost window of an app that has several", () => {
    const out = captureLayoutWindows(
      wins(win("notes", 100), win("files", 101), win("notes", 102)),
      restorable,
    );
    assert.deepEqual(
      out.map((e) => [e.appId, e.rect.x]),
      [
        ["files", 101],
        ["notes", 102],
      ],
    );
  });

  it("saves a maximised window at the rectangle it returns to", () => {
    const out = captureLayoutWindows(
      wins(
        win("notes", 100, {
          isMaximized: true,
          position: { x: 12, y: 88 },
          size: { width: 1900, height: 900 },
          restoreBounds: {
            position: { x: 40, y: 50 },
            size: { width: 700, height: 450 },
          },
        }),
      ),
      restorable,
    );
    assert.deepEqual(out[0].rect, { x: 40, y: 50, width: 700, height: 450 });
  });

  it("counts a minimised window and leaves out web apps and apps launch cannot open", () => {
    const out = captureLayoutWindows(
      wins(
        win("notes", 100, { isMinimized: true }),
        win("web-app", 101),
        win("settings", 102),
      ),
      new Set([...restorable, "web-app"]),
    );
    assert.deepEqual(
      out.map((e) => e.appId),
      ["notes"],
    );
  });

  it("is empty for an empty desktop, and never over the limit (the front windows stay)", () => {
    assert.deepEqual(captureLayoutWindows({}, restorable), []);
    const many = new Set(Array.from({ length: 30 }, (_, i) => `app${i}`));
    const list = [...many].map((appId, i) => win(appId, 100 + i));
    const out = captureLayoutWindows(wins(...list), many);
    assert.equal(out.length, MAX_LAYOUT_WINDOWS);
    assert.equal(out.at(-1).appId, "app29");
  });

  it("skips a window whose rectangle is not usable", () => {
    const out = captureLayoutWindows(
      wins(win("notes", 100, { size: { width: 0, height: 400 } }), win("files", 101)),
      restorable,
    );
    assert.deepEqual(
      out.map((e) => e.appId),
      ["files"],
    );
  });
});

describe("planLayoutRestore", () => {
  const config = { minSize: { width: 360, height: 240 } };
  const fit = {
    titlebarHeight: 40,
    minVisibleX: 80,
    bottomReserve: 80,
    insets: { side: 12, top: 88, bottom: 96 },
  };
  const restorable = new Set(["notes", "files", "tasks"]);
  const roomy = { width: 1920, height: 1080 };
  const open = (id, appId, over = {}) => ({
    id,
    appId,
    zIndex: 100,
    isMinimized: false,
    ...over,
  });
  const record = (...list) => Object.fromEntries(list.map((w) => [w.id, w]));
  const plan = (over) =>
    planLayoutRestore({
      layout: [],
      windows: {},
      restorable,
      viewport: roomy,
      fit,
      minSize: config.minSize,
      ...over,
    });

  it("opens an app that is not open and moves one that is, in the saved order", () => {
    const res = plan({
      layout: [
        entry("files", rect(10, 100, 700, 500)),
        entry("notes", rect(300, 120, 800, 600)),
      ],
      windows: record(open("w1", "notes")),
    });
    assert.deepEqual(
      res.steps.map((s) => [s.appId, s.windowId]),
      [
        ["files", null],
        ["notes", "w1"],
      ],
    );
    assert.deepEqual(res.steps[0].geometry, {
      position: { x: 10, y: 100 },
      size: { width: 700, height: 500 },
    });
  });

  it("moves the topmost window of an app that has several, even a minimised one", () => {
    const res = plan({
      layout: [entry("notes")],
      windows: record(
        open("low", "notes", { zIndex: 100 }),
        open("high", "notes", { zIndex: 105, isMinimized: true }),
      ),
    });
    assert.equal(res.steps[0].windowId, "high");
  });

  it("counts the visible windows the layout does not mention, and never plans to close any", () => {
    const res = plan({
      layout: [entry("notes")],
      windows: record(
        open("w1", "notes"),
        open("w2", "tasks"),
        open("w3", "files", { isMinimized: true }),
        open("w4", "web-app"),
      ),
    });
    assert.equal(res.untouched, 2);
    assert.deepEqual(
      res.steps.map((s) => s.windowId),
      ["w1"],
    );
  });

  it("clamps a rectangle from a bigger screen to the current viewport", () => {
    const res = plan({
      layout: [entry("notes", rect(1500, 700, 1800, 1000))],
      viewport: { width: 1280, height: 720 },
    });
    const { position, size } = res.steps[0].geometry;
    assert.ok(size.width <= 1280 - 24, "narrower than the screen");
    assert.ok(size.height <= 720 - 88 - 96, "shorter than the keep-clear area");
    assert.ok(position.x + 80 <= 1280, "the title bar stays reachable on the right");
    assert.ok(
      position.y >= 0 && position.y <= 720 - 80 - 40,
      "and above the command bar",
    );
  });

  it("brings a window that was off the left edge back on screen", () => {
    const res = plan({
      layout: [entry("notes", rect(-2000, -300, 600, 400))],
    });
    const { position, size } = res.steps[0].geometry;
    assert.ok(position.x + size.width >= 80);
    assert.equal(position.y, 0);
  });

  it("never goes below the minimum size (an open window's own minimum counts)", () => {
    const res = plan({
      layout: [
        entry("notes", rect(0, 0, 100, 100)),
        entry("files", rect(0, 0, 100, 100)),
      ],
      windows: record(open("w1", "notes", { minSize: { width: 500, height: 300 } })),
    });
    assert.deepEqual(res.steps[0].geometry.size, { width: 500, height: 300 });
    assert.deepEqual(res.steps[1].geometry.size, { width: 360, height: 240 });
  });

  it("leaves a rectangle that fits exactly as saved", () => {
    const res = plan({ layout: [entry("notes", rect(100, 120, 900, 600))] });
    assert.deepEqual(res.steps[0].geometry, {
      position: { x: 100, y: 120 },
      size: { width: 900, height: 600 },
    });
  });

  it("skips an app that cannot be opened any more and says so", () => {
    const res = plan({ layout: [entry("gone"), entry("notes"), entry("web-app")] });
    assert.deepEqual(
      res.steps.map((s) => s.appId),
      ["notes"],
    );
    assert.deepEqual(res.skipped, ["gone", "web-app"]);
  });

  it("ignores a repeated app, and plans at most the window limit", () => {
    const res = plan({ layout: [entry("notes"), entry("notes", rect(1, 1))] });
    assert.equal(res.steps.length, 1);
    const many = new Set(Array.from({ length: 30 }, (_, i) => `app${i}`));
    const big = plan({
      layout: [...many].map((id) => entry(id)),
      restorable: many,
    });
    assert.equal(big.steps.length, MAX_LAYOUT_WINDOWS);
  });

  it("plans nothing for an empty layout", () => {
    const res = plan({ windows: record(open("w1", "notes")) });
    assert.deepEqual(res.steps, []);
    assert.equal(res.untouched, 1);
  });

  it("without a viewport uses the saved rectangles (raised to the minimum)", () => {
    const res = plan({ layout: [entry("notes", rect(5, 6, 700, 500))], viewport: null });
    assert.deepEqual(res.steps[0].geometry.position, { x: 5, y: 6 });
  });
});

describe("describeRestore", () => {
  it("says what was opened and moved", () => {
    assert.equal(
      describeRestore({
        opened: 2,
        moved: 1,
        skipped: 0,
        untouched: 0,
        minimized: false,
      }),
      "Opened 2 apps, moved 1 window.",
    );
    assert.equal(
      describeRestore({
        opened: 1,
        moved: 0,
        skipped: 0,
        untouched: 0,
        minimized: false,
      }),
      "Opened 1 app.",
    );
  });

  it("says what was left open or minimised, and what could not be opened", () => {
    assert.equal(
      describeRestore({
        opened: 0,
        moved: 2,
        skipped: 1,
        untouched: 3,
        minimized: false,
      }),
      "Moved 2 windows. 1 app is no longer available. 3 other windows left open.",
    );
    assert.match(
      describeRestore({ opened: 1, moved: 0, skipped: 0, untouched: 1, minimized: true }),
      /1 other window minimised\.$/,
    );
  });

  it("copes with nothing to do", () => {
    assert.equal(
      describeRestore({
        opened: 0,
        moved: 0,
        skipped: 0,
        untouched: 0,
        minimized: false,
      }),
      "Nothing to open.",
    );
  });
});
