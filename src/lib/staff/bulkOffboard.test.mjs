// Bulk "Remove from roster": the wording, and which checklists an Undo drops.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LISTED_NAMES,
  dropUntouchedOffboarding,
  nameList,
  offboardConfirmText,
  offboardTitle,
  removedMessage,
  restoredMessage,
} from "./bulkOffboard.ts";

const person = (n) => ({
  firstName: `First${n}`,
  lastName: `Last${n}`,
  deloitteEmail: `p${n}@x.com`,
});
const list = (id, employeeId, kind, ...done) => ({
  id,
  employeeId,
  name: employeeId,
  kind,
  createdAt: "",
  items: done.map((d, i) => ({ id: `${id}-${i}`, text: "t", done: d })),
});

describe("wording", () => {
  it("counts people in the title and the toasts", () => {
    assert.equal(offboardTitle(1), "Remove 1 person from the roster?");
    assert.equal(offboardTitle(4), "Remove 4 people from the roster?");
    assert.equal(removedMessage(1), "1 person is on the Offboarded tab.");
    assert.equal(removedMessage(3), "3 people are on the Offboarded tab.");
    assert.equal(restoredMessage(1), "1 person is back on the roster.");
    assert.equal(restoredMessage(3), "3 people are back on the roster.");
  });

  it("says what offboarding does and that it can be undone", () => {
    const text = offboardConfirmText();
    assert.match(text, /Offboarded tab/);
    assert.match(text, /Undo/);
    assert.match(text, /time-off requests are deleted/);
  });
});

describe("nameList", () => {
  it("lists a few names and counts the rest", () => {
    assert.deepEqual(nameList([person(1), person(2)]), {
      names: ["First1 Last1", "First2 Last2"],
      more: 0,
    });
    const lots = nameList(Array.from({ length: LISTED_NAMES + 3 }, (_, i) => person(i)));
    assert.equal(lots.names.length, LISTED_NAMES);
    assert.equal(lots.more, 3);
  });
});

describe("dropUntouchedOffboarding", () => {
  it("drops only untouched offboarding checklists of the people put back", () => {
    const lists = [
      list("a", "e1", "offboarding", false, false),
      list("b", "e1", "onboarding", false),
      list("c", "e2", "offboarding", true, false),
      list("d", "e3", "offboarding", false),
    ];
    const kept = dropUntouchedOffboarding(lists, ["e1", "e2"]);
    assert.deepEqual(
      kept.map((c) => c.id),
      ["b", "c", "d"],
    );
  });
});
