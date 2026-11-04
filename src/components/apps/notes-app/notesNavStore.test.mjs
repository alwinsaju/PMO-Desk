import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useNotesNav } from "./notesNavStore.ts";

describe("notes navigation request", () => {
  it("holds the requested note until it is cleared", () => {
    useNotesNav.getState().requestOpen("n1");
    const first = useNotesNav.getState().openRequest;
    assert.equal(first.noteId, "n1");
    useNotesNav.getState().clearOpenRequest(first.id);
    assert.equal(useNotesNav.getState().openRequest, null);
  });

  it("gives each request its own id, and a stale clear does not drop a newer one", () => {
    useNotesNav.getState().requestOpen("a");
    const a = useNotesNav.getState().openRequest;
    useNotesNav.getState().requestOpen("b");
    const b = useNotesNav.getState().openRequest;
    assert.notEqual(a.id, b.id);
    useNotesNav.getState().clearOpenRequest(a.id);
    assert.equal(useNotesNav.getState().openRequest.noteId, "b");
    useNotesNav.getState().clearOpenRequest(b.id);
  });
});
