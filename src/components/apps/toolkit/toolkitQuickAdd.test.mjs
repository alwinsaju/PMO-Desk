import assert from "node:assert/strict";
import test from "node:test";
import { REGISTER_IDS } from "../../../lib/registers/defs.ts";
import { NO_QUICK_ADD, quickAddLabel, supportsQuickAdd } from "./toolkitQuickAdd.ts";

test("every register tool except Timesheets supports quick add", () => {
  const supported = REGISTER_IDS.filter((id) => supportsQuickAdd(id, REGISTER_IDS));
  assert.equal(supported.length, REGISTER_IDS.length - 1);
  assert.equal(supported.length, 13);
  assert.ok(!supported.includes("timesheets"));
  assert.ok(supported.includes("raid"));
});

test("Timesheets never gets a plus, even if it were listed as a register", () => {
  assert.deepEqual([...NO_QUICK_ADD], ["timesheets"]);
  assert.equal(supportsQuickAdd("timesheets", ["timesheets", "raid"]), false);
});

test("an unknown tool id does not support quick add", () => {
  assert.equal(supportsQuickAdd("nope", REGISTER_IDS), false);
  assert.equal(supportsQuickAdd("raid", []), false);
});

test("the plus button is named after the tool", () => {
  assert.equal(quickAddLabel("RAID log"), "Add a RAID log");
  assert.equal(quickAddLabel("Decision log"), "Add a Decision log");
});
