import assert from "node:assert/strict";
import { test } from "node:test";
import { actorLabel, readableDetails } from "./auditReadable.ts";
import { parseAuditLine } from "./auditView.ts";

test("readableDetails drops raw ids and keeps plain facts", () => {
  assert.deepEqual(
    readableDetails({
      proposalId: "pr_67a0bf7a6226ce12a52c",
      todoId: "td_a2c10ea8b07111db7ef2",
      edited: false,
    }),
    ["Edited: No"],
  );
});

test("readableDetails is empty when only ids were recorded", () => {
  assert.deepEqual(readableDetails({ todoId: "td_e58060506663401a" }), []);
});

test("readableDetails words numbers, lists and camelCase keys", () => {
  assert.deepEqual(readableDetails({ removed: 3, ids: ["td_aaaaaaaa", "td_bbbbbbbb"] }), [
    "Removed: 3",
  ]);
  assert.deepEqual(readableDetails({ changed: ["setup", "chaserDays"] }), [
    "Changed: setup, chaserDays",
  ]);
  assert.deepEqual(readableDetails({ reportWeek: "2026-W10", ok: true }), [
    "Report week: 2026-W10",
    "Ok: Yes",
  ]);
});

test("readableDetails shortens long lists and skips empty values", () => {
  assert.deepEqual(readableDetails({ fields: ["a", "b", "c", "d", "e"], why: "" }), [
    "Fields: a, b, c +2",
  ]);
});

test("actorLabel says You for the signed-in OS user", () => {
  assert.equal(actorLabel("alsaju"), "You");
  assert.equal(actorLabel(""), "");
});

test("parseAuditLine keeps raw details for export and adds readable ones", () => {
  const entry = parseAuditLine(
    JSON.stringify({
      ts: "2026-03-02T09:00:00Z",
      action: "create-manual",
      user: "alsaju",
      todoId: "td_e58060506663401a",
    }),
  );
  assert.deepEqual(entry.details, ["todoId: td_e58060506663401a"]);
  assert.deepEqual(entry.readable, []);
  assert.equal(entry.user, "alsaju");
});
