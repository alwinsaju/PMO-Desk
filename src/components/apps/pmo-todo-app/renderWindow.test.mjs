import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_SIZE, growLimit, revealTarget, windowNote } from "./renderWindow.ts";

test("growLimit adds a page and never passes the total", () => {
  assert.equal(growLimit(60, 523), 120);
  assert.equal(growLimit(500, 523), 523);
  assert.equal(growLimit(60, 80), 80);
});

test("growLimit reveals up to a given index in whole pages", () => {
  assert.equal(growLimit(60, 523, 60), 120);
  assert.equal(growLimit(60, 523, 522), 523);
  assert.equal(growLimit(60, 523, 130), 180);
  assert.equal(PAGE_SIZE, 60);
});

test("revealTarget: only a move past the last drawn card, or End, needs more", () => {
  assert.equal(revealTarget("j", 59, 60, 523), 60);
  assert.equal(revealTarget("ArrowDown", 59, 60, 523), 60);
  assert.equal(revealTarget("j", 10, 60, 523), null);
  assert.equal(revealTarget("k", 59, 60, 523), null);
  assert.equal(revealTarget("End", 3, 60, 523), 522);
  assert.equal(revealTarget("End", 3, 60, 60), null);
  assert.equal(revealTarget("j", 59, 60, 60), null);
  assert.equal(revealTarget("Home", 59, 60, 523), null);
});

test("windowNote says how many are drawn only while some are not", () => {
  assert.equal(windowNote(60, 523), "Showing 60 of 523 to-dos");
  assert.equal(windowNote(523, 523), null);
});
