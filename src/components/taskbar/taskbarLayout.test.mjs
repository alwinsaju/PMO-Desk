// Run with `pnpm test` (Node's built-in test runner imports the .ts module
// directly). Pure list logic behind the user-editable taskbar — no React, no
// store, no DOM.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appIdForWindow,
  buildTaskbarItems,
  defaultLayout,
  defaultPinnedIds,
  isDefaultPinnedIds,
  migrateLegacyPinned,
  pinId,
  placeId,
  reconcileBuiltIns,
  sanitizeIds,
  unpinId,
} from "./taskbarLayout.ts";

// Mirrors `builtInApps` in pinnedApps.ts (which can't be imported here: it
// pulls in Phosphor icon components). Kept in sync by hand only for ids.
const BUILT_INS = ["files", "notes", "browser", "tasks", "app-store"];

describe("default layout", () => {
  it("is every built-in, in order, and is a copy", () => {
    const ids = defaultPinnedIds(BUILT_INS);
    assert.deepEqual(ids, BUILT_INS);
    assert.notEqual(ids, BUILT_INS);
    assert.deepEqual(defaultLayout(BUILT_INS), {
      pinnedIds: BUILT_INS,
      knownBuiltInIds: BUILT_INS,
    });
  });

  it("isDefaultPinnedIds compares membership AND order", () => {
    assert.equal(isDefaultPinnedIds(BUILT_INS, BUILT_INS), true);
    assert.equal(isDefaultPinnedIds(["notes", "files"], BUILT_INS), false);
    assert.equal(isDefaultPinnedIds([...BUILT_INS].reverse(), BUILT_INS), false);
    assert.equal(isDefaultPinnedIds([...BUILT_INS, "gmail"], BUILT_INS), false);
    assert.equal(isDefaultPinnedIds([], BUILT_INS), false);
  });
});

describe("pin / unpin", () => {
  it("any built-in can be unpinned, including app-store", () => {
    let ids = defaultPinnedIds(BUILT_INS);
    for (const id of BUILT_INS) ids = unpinId(ids, id);
    assert.deepEqual(ids, []);
  });

  it("unpin keeps the order of what remains", () => {
    assert.deepEqual(unpinId(BUILT_INS, "browser"), [
      "files",
      "notes",
      "tasks",
      "app-store",
    ]);
  });

  it("pin appends, and is a no-op (same reference) when already pinned", () => {
    const ids = ["files"];
    assert.deepEqual(pinId(ids, "gmail"), ["files", "gmail"]);
    assert.equal(pinId(ids, "files"), ids);
    assert.equal(unpinId(ids, "nope"), ids);
  });

  it("pin does not mutate its input", () => {
    const ids = Object.freeze(["files"]);
    assert.deepEqual(pinId(ids, "notes"), ["files", "notes"]);
    assert.deepEqual(unpinId(ids, "files"), []);
    assert.deepEqual(ids, ["files"]);
  });

  it("a built-in unpinned then pinned again goes to the end", () => {
    const ids = pinId(unpinId(BUILT_INS, "files"), "files");
    assert.deepEqual(ids, ["notes", "browser", "tasks", "app-store", "files"]);
  });
});

describe("placeId (reorder / drop at a position)", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves before a target", () => {
    assert.deepEqual(placeId(ids, "d", "b"), ["a", "d", "b", "c"]);
    assert.deepEqual(placeId(ids, "c", "a"), ["c", "a", "b", "d"]);
  });

  it("moves after a target", () => {
    assert.deepEqual(placeId(ids, "a", "c", true), ["b", "c", "a", "d"]);
    assert.deepEqual(placeId(ids, "a", "d", true), ["b", "c", "d", "a"]);
  });

  it("pins a not-yet-pinned id next to the target", () => {
    assert.deepEqual(placeId(ids, "x", "b"), ["a", "x", "b", "c", "d"]);
    assert.deepEqual(placeId(ids, "x", "d", true), ["a", "b", "c", "d", "x"]);
  });

  it("returns the SAME reference when the drop changes nothing", () => {
    assert.equal(placeId(ids, "b", "c"), ids); // already right before c
    assert.equal(placeId(ids, "c", "b", true), ids); // already right after b
    assert.equal(placeId(ids, "a", "a"), ids); // onto itself
    assert.equal(placeId(ids, "b", "missing"), ids); // unknown target, already pinned
  });

  it("appends an unpinned id dropped on itself or an unknown target", () => {
    assert.deepEqual(placeId(ids, "x", "x"), [...ids, "x"]);
    assert.deepEqual(placeId(ids, "x", "missing"), [...ids, "x"]);
  });
});

describe("sanitizeIds (untrusted persisted data)", () => {
  it("keeps strings, drops junk and duplicates, first occurrence wins", () => {
    assert.deepEqual(sanitizeIds(["a", 1, "", null, "b", "a", {}, "c"]), ["a", "b", "c"]);
  });

  it("an empty array is a legitimate 'user unpinned everything'", () => {
    assert.deepEqual(sanitizeIds([]), []);
  });

  it("returns null for anything that is not an array", () => {
    for (const bad of [undefined, null, "files", 5, {}, { 0: "a" }]) {
      assert.equal(sanitizeIds(bad), null);
    }
  });
});

describe("reconcileBuiltIns (a built-in added in a later release)", () => {
  it("is a no-op (same reference) when the layout already knows every built-in", () => {
    const layout = { pinnedIds: ["notes", "gmail"], knownBuiltInIds: BUILT_INS };
    assert.equal(reconcileBuiltIns(layout, BUILT_INS), layout);
  });

  it("does NOT re-pin a built-in the user removed (it is known)", () => {
    const layout = { pinnedIds: ["notes"], knownBuiltInIds: BUILT_INS };
    assert.deepEqual(reconcileBuiltIns(layout, BUILT_INS).pinnedIds, ["notes"]);
  });

  it("appends a brand-new built-in exactly once and records it as known", () => {
    const next = [...BUILT_INS, "pmo-todo"];
    const layout = { pinnedIds: ["notes", "gmail"], knownBuiltInIds: BUILT_INS };
    const once = reconcileBuiltIns(layout, next);
    assert.deepEqual(once.pinnedIds, ["notes", "gmail", "pmo-todo"]);
    assert.deepEqual(once.knownBuiltInIds, next);
    // The user then unpins it: a later reconcile must leave it unpinned.
    const unpinned = { ...once, pinnedIds: unpinId(once.pinnedIds, "pmo-todo") };
    assert.deepEqual(reconcileBuiltIns(unpinned, next).pinnedIds, ["notes", "gmail"]);
  });

  it("does not duplicate a new built-in that is somehow already pinned", () => {
    const layout = { pinnedIds: ["pmo-todo", "notes"], knownBuiltInIds: BUILT_INS };
    const out = reconcileBuiltIns(layout, [...BUILT_INS, "pmo-todo"]);
    assert.deepEqual(out.pinnedIds, ["pmo-todo", "notes"]);
  });

  it("a fresh default layout is already reconciled", () => {
    const fresh = defaultLayout([...BUILT_INS, "pmo-todo"]);
    assert.equal(reconcileBuiltIns(fresh, [...BUILT_INS, "pmo-todo"]), fresh);
  });
});

describe("migrateLegacyPinned (v0 -> current)", () => {
  it("puts the old implicit built-ins first, then the old extra pins in order", () => {
    assert.deepEqual(migrateLegacyPinned(["gmail", "slack"], BUILT_INS), {
      pinnedIds: [...BUILT_INS, "gmail", "slack"],
      knownBuiltInIds: BUILT_INS,
    });
  });

  it("tolerates missing/garbage legacy data", () => {
    assert.deepEqual(migrateLegacyPinned(undefined, BUILT_INS).pinnedIds, BUILT_INS);
    assert.deepEqual(migrateLegacyPinned("nope", BUILT_INS).pinnedIds, BUILT_INS);
    assert.deepEqual(migrateLegacyPinned([1, null, "gmail"], BUILT_INS).pinnedIds, [
      ...BUILT_INS,
      "gmail",
    ]);
  });

  it("never duplicates a built-in that also appears in the legacy list", () => {
    assert.deepEqual(migrateLegacyPinned(["notes", "gmail"], BUILT_INS).pinnedIds, [
      ...BUILT_INS,
      "gmail",
    ]);
  });
});

describe("buildTaskbarItems (pinned tiles + temporary open-window tiles)", () => {
  it("is just the pinned apps, in order, when nothing else is open", () => {
    assert.deepEqual(buildTaskbarItems(["notes", "files"], []), [
      { id: "notes", pinned: true },
      { id: "files", pinned: true },
    ]);
  });

  it("an open window of an UNPINNED app gets a temporary tile after the pinned ones", () => {
    assert.deepEqual(buildTaskbarItems(["notes"], ["browser"]), [
      { id: "notes", pinned: true },
      { id: "browser", pinned: false },
    ]);
  });

  it("an open window of a pinned app adds no second tile", () => {
    assert.deepEqual(buildTaskbarItems(["notes"], ["notes", "notes"]), [
      { id: "notes", pinned: true },
    ]);
  });

  it("temporary tiles are deduped and keep window-open order", () => {
    const items = buildTaskbarItems(
      ["notes"],
      ["tasks", "files", "tasks", "notes", "files"],
    );
    assert.deepEqual(
      items.map((i) => i.id),
      ["notes", "tasks", "files"],
    );
    assert.deepEqual(
      items.map((i) => i.pinned),
      [true, false, false],
    );
  });

  it("a fully emptied taskbar still shows open windows, and the tile goes when they close", () => {
    assert.deepEqual(buildTaskbarItems([], ["files"]), [{ id: "files", pinned: false }]);
    assert.deepEqual(buildTaskbarItems([], []), []);
  });

  it("unpinning an app that has an open window turns its tile temporary, not gone", () => {
    const before = buildTaskbarItems(BUILT_INS, ["notes"]);
    assert.equal(before.find((i) => i.id === "notes").pinned, true);
    const after = buildTaskbarItems(unpinId(BUILT_INS, "notes"), ["notes"]);
    const notes = after.find((i) => i.id === "notes");
    assert.equal(notes.pinned, false);
    assert.equal(after.at(-1).id, "notes");
  });
});

describe("appIdForWindow", () => {
  const byUrl = new Map([["https://mail.google.com/", "gmail"]]);
  const known = new Set([...BUILT_INS, "gmail"]);

  it("a built-in window's appId is its app id", () => {
    assert.equal(appIdForWindow({ appId: "notes" }, byUrl, known), "notes");
  });

  it("a web-app window resolves to its catalog entry by url", () => {
    const w = { appId: "web-app", url: "https://mail.google.com/" };
    assert.equal(appIdForWindow(w, byUrl, known), "gmail");
  });

  it("windows with no matching taskbar app get no tile", () => {
    assert.equal(
      appIdForWindow({ appId: "web-app", url: "https://x.test/" }, byUrl, known),
      undefined,
    );
    assert.equal(appIdForWindow({ appId: "web-app" }, byUrl, known), undefined);
    assert.equal(appIdForWindow({ appId: "mystery" }, byUrl, known), undefined);
  });
});
