import assert from "node:assert/strict";
import { test } from "node:test";
import { changesTodos } from "./attentionRefresh.ts";

test("a successful write refreshes the dock badge", () => {
  assert.equal(changesTodos("POST", "/todos", true), true);
  assert.equal(changesTodos("PATCH", "/todos/abc", true), true);
  assert.equal(changesTodos("DELETE", "/todos/abc", true), true);
});

test("reads, refused writes and the reminder routes do not", () => {
  assert.equal(changesTodos("GET", "/state", true), false);
  assert.equal(changesTodos("PATCH", "/todos/abc", false), false);
  assert.equal(changesTodos("POST", "/due/claim", true), false);
  assert.equal(changesTodos("POST", "/due/ack", true), false);
});
