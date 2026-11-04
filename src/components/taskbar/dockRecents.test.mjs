import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCK_RECENTS_KEY,
  MAX_DOCK_RECENTS,
  isDockRecentApp,
  loadDockRecents,
  pushDockRecent,
  sanitizeDockRecents,
  saveDockRecents,
  syncDockRecents,
} from "./dockRecents.ts";
import { useDockRecents } from "./dockRecentsStore.ts";

const item = (id, title = `Title ${id}`) => ({ id, title });

describe("pushDockRecent", () => {
  it("puts the newest first and moves a repeat to the front with its new title", () => {
    let list = [];
    list = pushDockRecent(list, item("a"));
    list = pushDockRecent(list, item("b"));
    list = pushDockRecent(list, item("a", "Renamed"));
    assert.deepEqual(list, [item("a", "Renamed"), item("b")]);
  });

  it("keeps only the last few", () => {
    let list = [];
    for (let i = 0; i < 10; i++) list = pushDockRecent(list, item(String(i)));
    assert.equal(list.length, MAX_DOCK_RECENTS);
    assert.deepEqual(
      list.map((r) => r.id),
      ["9", "8", "7", "6"],
    );
  });

  it("ignores an entry with no id or title, and tidies long or spaced titles", () => {
    const base = [item("a")];
    assert.deepEqual(pushDockRecent(base, item("", "x")), base);
    assert.deepEqual(pushDockRecent(base, item("b", "   ")), base);
    const [first] = pushDockRecent(base, item("c", `  two\n  words ${"x".repeat(200)}`));
    assert.ok(first.title.startsWith("two words x"));
    assert.ok(first.title.length <= 80);
  });

  it("does not change the list it was given", () => {
    const base = Object.freeze([item("a")]);
    pushDockRecent(base, item("b"));
    assert.equal(base.length, 1);
  });
});

describe("syncDockRecents", () => {
  const live = new Map([
    ["a", "Title a"],
    ["b", "Brand new name"],
  ]);
  it("drops what is gone and refreshes renamed titles", () => {
    const list = [item("a"), item("b"), item("c")];
    assert.deepEqual(
      syncDockRecents(list, (id) => live.get(id)),
      [item("a"), item("b", "Brand new name")],
    );
  });

  it("returns the same array when nothing changed", () => {
    const list = [item("a")];
    assert.equal(
      syncDockRecents(list, (id) => live.get(id)),
      list,
    );
  });

  it("drops an item whose current title is empty", () => {
    assert.deepEqual(
      syncDockRecents([item("a")], () => "  "),
      [],
    );
  });
});

describe("sanitizeDockRecents", () => {
  it("keeps well-formed entries of known apps only", () => {
    const out = sanitizeDockRecents({
      "pmo-todo": [item("1"), { id: 2, title: "bad" }, null, item("1"), item("3")],
      templates: "nope",
      notes: [item("x")],
    });
    assert.deepEqual(out, { "pmo-todo": [item("1"), item("3")] });
  });

  it("caps each list and survives junk", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(String(i)));
    assert.equal(sanitizeDockRecents({ templates: many }).templates.length, 4);
    for (const junk of [null, undefined, 5, "x", [], [item("a")]]) {
      assert.deepEqual(sanitizeDockRecents(junk), {});
    }
  });
});

describe("storage helpers", () => {
  it("round-trips through a storage", () => {
    const data = new Map();
    const storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    assert.equal(saveDockRecents(storage, { templates: [item("t")] }), true);
    assert.ok(data.has(DOCK_RECENTS_KEY));
    assert.deepEqual(loadDockRecents(storage), { templates: [item("t")] });
  });

  it("gives nothing, and does not throw, when storage is missing, throws or holds junk", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    assert.deepEqual(loadDockRecents(null), {});
    assert.deepEqual(loadDockRecents(throwing), {});
    assert.equal(saveDockRecents(null, {}), false);
    assert.equal(saveDockRecents(throwing, {}), false);
    assert.deepEqual(loadDockRecents({ getItem: () => "{not json", setItem() {} }), {});
  });
});

describe("which apps have recents", () => {
  it("is PMO To-Do and Templates", () => {
    assert.equal(isDockRecentApp("pmo-todo"), true);
    assert.equal(isDockRecentApp("templates"), true);
    assert.equal(isDockRecentApp("notes"), false);
  });
});

describe("dock recents store (no browser storage here)", () => {
  it("remembers, ignores other apps, and syncs", () => {
    const { remember, sync } = useDockRecents.getState();
    remember("pmo-todo", item("t1"));
    remember("pmo-todo", item("t2"));
    remember("notes", item("n1"));
    let recents = useDockRecents.getState().recents;
    assert.deepEqual(
      recents["pmo-todo"].map((r) => r.id),
      ["t2", "t1"],
    );
    assert.equal(recents.notes, undefined);

    sync("pmo-todo", (id) => (id === "t1" ? "Renamed" : undefined));
    recents = useDockRecents.getState().recents;
    assert.deepEqual(recents["pmo-todo"], [item("t1", "Renamed")]);

    sync("pmo-todo", () => undefined);
    assert.equal(useDockRecents.getState().recents["pmo-todo"], undefined);
  });
});
