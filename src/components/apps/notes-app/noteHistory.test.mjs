import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_HISTORY,
  TYPING_GROUP_MS,
  emptyHistory,
  historyKey,
  recordChange,
  redo,
  undo,
} from "./noteHistory.ts";

const snap = (text) => ({ text, start: text.length, end: text.length });

describe("noteHistory", () => {
  it("undoes and redoes a toolbar action after typing", () => {
    let h = recordChange(emptyHistory(), snap("a"), "type", 0);
    h = recordChange(h, snap("ab"), "format", 5000);
    const back = undo(h, snap("**ab**"));
    assert.equal(back.snapshot.text, "ab");
    const back2 = undo(back.history, snap("ab"));
    assert.equal(back2.snapshot.text, "a");
    assert.equal(undo(back2.history, snap("a")), null);
    const forward = redo(back2.history, snap("a"));
    assert.equal(forward.snapshot.text, "ab");
    assert.equal(redo(forward.history, snap("ab")).snapshot.text, "**ab**");
  });

  it("groups quick typing into one step, but not slow typing or a format", () => {
    let h = recordChange(emptyHistory(), snap(""), "type", 0);
    h = recordChange(h, snap("a"), "type", 100);
    h = recordChange(h, snap("ab"), "type", 200);
    assert.equal(h.past.length, 1);
    h = recordChange(h, snap("abc"), "type", 200 + TYPING_GROUP_MS);
    assert.equal(h.past.length, 2);
    h = recordChange(h, snap("abcd"), "format", 200 + TYPING_GROUP_MS + 10);
    h = recordChange(h, snap("abcde"), "type", 200 + TYPING_GROUP_MS + 20);
    assert.equal(h.past.length, 4);
  });

  it("a new change drops the redo steps", () => {
    let h = recordChange(emptyHistory(), snap("a"), "type", 0);
    h = undo(h, snap("ab")).history;
    assert.equal(h.future.length, 1);
    h = recordChange(h, snap("a"), "type", 10);
    assert.equal(h.future.length, 0);
  });

  it("keeps a bounded history", () => {
    let h = emptyHistory();
    for (let i = 0; i < MAX_HISTORY + 50; i++) {
      h = recordChange(h, snap(String(i)), "format", i);
    }
    assert.equal(h.past.length, MAX_HISTORY);
    assert.equal(h.past[h.past.length - 1].text, String(MAX_HISTORY + 49));
  });

  it("reads the undo and redo keys", () => {
    const key = (k, extra = {}) => ({
      key: k,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...extra,
    });
    assert.equal(historyKey(key("z")), "undo");
    assert.equal(historyKey(key("Z", { shiftKey: true })), "redo");
    assert.equal(historyKey(key("y")), "redo");
    assert.equal(historyKey(key("z", { ctrlKey: false })), null);
    assert.equal(historyKey(key("b")), null);
  });
});
