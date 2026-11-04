// Keyboard movement through Staff rows, Templates and Toolkit tiles: the same keys as the to-do
// list, minus done and snooze, with Enter left to the element and nothing taken while typing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRowKey, rowKeyAction } from "./rowNav.ts";

const act = (key, index, count = 5, options, mods = {}) =>
  rowKeyAction({ key, ...mods }, index, count, options);

describe("rowKeyAction", () => {
  it("moves with J/K, the arrows, Home and End inside the list", () => {
    assert.deepEqual(act("j", 1), { type: "move", index: 2 });
    assert.deepEqual(act("k", 1), { type: "move", index: 0 });
    assert.deepEqual(act("ArrowDown", 4), { type: "move", index: 4 });
    assert.deepEqual(act("ArrowUp", 0), { type: "move", index: 0 });
    assert.deepEqual(act("Home", 3), { type: "move", index: 0 });
    assert.deepEqual(act("End", 0), { type: "move", index: 4 });
  });

  it("enters the list at its first row", () => {
    assert.deepEqual(act("j", -1), { type: "move", index: 0 });
    assert.deepEqual(act("k", -1), { type: "move", index: 0 });
  });

  it("opens with E on a row, never from outside the rows", () => {
    assert.deepEqual(act("e", 2), { type: "open" });
    assert.equal(act("e", -1), null);
  });

  it("leaves Enter to the element, and has no done, snooze or Delete key", () => {
    for (const key of ["Enter", "d", "s", "Delete", "Backspace", "x"]) {
      assert.equal(act(key, 2), null, key);
    }
  });

  it("can switch the arrows off for a grid", () => {
    assert.equal(act("ArrowDown", 1, 5, { arrows: false }), null);
    assert.equal(act("ArrowUp", 1, 5, { arrows: false }), null);
    assert.deepEqual(act("j", 1, 5, { arrows: false }), { type: "move", index: 2 });
    assert.deepEqual(act("End", 1, 5, { arrows: false }), { type: "move", index: 4 });
  });

  it("ignores modifier combinations and an empty list", () => {
    assert.equal(act("j", 1, 5, undefined, { ctrlKey: true }), null);
    assert.equal(act("e", 1, 5, undefined, { metaKey: true }), null);
    assert.equal(act("j", 0, 0), null);
  });
});

describe("handleRowKey", () => {
  const item = (name, log) => ({
    name,
    focus: () => log.push(`focus ${name}`),
    click: () => log.push(`click ${name}`),
  });
  const three = (log) => ["a", "b", "c"].map((n) => item(n, log));
  const press = (key, target, current, rows = three) => {
    const log = [];
    const items = rows(log);
    let prevented = 0;
    const used = handleRowKey(
      { key, target: target(items), preventDefault: () => (prevented += 1) },
      items,
      current(items),
    );
    return { used, prevented, log };
  };

  it("moves focus to the next and previous row and cancels the key", () => {
    const next = press(
      "j",
      (r) => r[0],
      (r) => r[0],
    );
    assert.deepEqual(next, { used: true, prevented: 1, log: ["focus b"] });
    assert.deepEqual(
      press(
        "k",
        (r) => r[2],
        (r) => r[2],
      ).log,
      ["focus b"],
    );
    assert.deepEqual(
      press(
        "End",
        (r) => r[0],
        (r) => r[0],
      ).log,
      ["focus c"],
    );
    assert.deepEqual(
      press(
        "Home",
        (r) => r[2],
        (r) => r[2],
      ).log,
      ["focus a"],
    );
  });

  it("moves from a control inside a row as if from that row", () => {
    const result = press(
      "j",
      () => ({ tagName: "BUTTON" }),
      (r) => r[1],
    );
    assert.deepEqual(result.log, ["focus c"]);
  });

  it("opens only when the row itself has focus", () => {
    assert.deepEqual(
      press(
        "e",
        (r) => r[1],
        (r) => r[1],
      ).log,
      ["click b"],
    );
    const inside = press(
      "e",
      () => ({ tagName: "BUTTON" }),
      (r) => r[1],
    );
    assert.deepEqual(inside, { used: false, prevented: 0, log: [] });
  });

  it("takes nothing while typing in a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      const r = press(
        "j",
        () => ({ tagName }),
        (rows) => rows[0],
      );
      assert.deepEqual(r, { used: false, prevented: 0, log: [] }, tagName);
    }
    const editable = press(
      "e",
      () => ({ tagName: "DIV", isContentEditable: true }),
      (r) => r[0],
    );
    assert.equal(editable.used, false);
  });

  it("enters the list from outside its rows and leaves other keys alone", () => {
    assert.deepEqual(
      press(
        "j",
        () => null,
        () => null,
      ).log,
      ["focus a"],
    );
    assert.equal(
      press(
        "Delete",
        (r) => r[0],
        (r) => r[0],
      ).used,
      false,
    );
    assert.equal(
      press(
        "Enter",
        (r) => r[0],
        (r) => r[0],
      ).used,
      false,
    );
    assert.equal(
      press(
        "j",
        () => null,
        () => null,
        () => [],
      ).used,
      false,
    );
  });
});
