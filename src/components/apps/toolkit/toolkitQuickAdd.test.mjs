import assert from "node:assert/strict";
import test from "node:test";
import { REGISTER_IDS } from "../../../lib/registers/defs.ts";
import {
  NO_QUICK_ADD,
  articleFor,
  quickAddLabel,
  supportsQuickAdd,
} from "./toolkitQuickAdd.ts";

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

const EXPECTED_LABELS = {
  raid: "Add a RAID item",
  minutes: "Add a set of minutes",
  decisions: "Add a decision",
  sla: "Add an SLA item",
  changes: "Add a change request",
  governance: "Add a governance meeting",
  stakeholders: "Add a stakeholder",
  vendors: "Add a contract",
  capacity: "Add an allocation",
  invoices: "Add an invoice",
  "status-report": "Add a status report",
  lessons: "Add a lesson",
  doclinks: "Add a link",
};

test("the plus button names one record of the tool, with the right article, for all 13 tools", () => {
  const supported = REGISTER_IDS.filter((id) => supportsQuickAdd(id, REGISTER_IDS));
  assert.equal(supported.length, 13);
  assert.deepEqual(Object.keys(EXPECTED_LABELS).sort(), [...supported].sort());
  for (const id of supported) {
    assert.equal(quickAddLabel(id), EXPECTED_LABELS[id], id);
  }
});

test("a label never uses the plural tool title or 'a' before a vowel sound", () => {
  for (const id of REGISTER_IDS.filter((i) => supportsQuickAdd(i, REGISTER_IDS))) {
    const label = quickAddLabel(id);
    assert.doesNotMatch(label, /^Add a [aeiou]/i, label);
    assert.doesNotMatch(label, /(requests|logs|registers)/i, label);
  }
});

test("articleFor follows how the word is said", () => {
  assert.equal(articleFor("invoice"), "an");
  assert.equal(articleFor("SLA item"), "an");
  assert.equal(articleFor("RAID item"), "a");
  assert.equal(articleFor("change request"), "a");
  assert.equal(articleFor("allocation"), "an");
});

test("an id that is not a register falls back to the title given", () => {
  assert.equal(quickAddLabel("nope", "Widget"), "Add a Widget");
});
