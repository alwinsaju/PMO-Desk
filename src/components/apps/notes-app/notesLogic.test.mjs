import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_REVISIONS,
  SAMPLE_NOTES,
  UNDO_WINDOW_MS,
  canRestoreRevision,
  clearSamples,
  isUndoActive,
  migrateNotesState,
  noteTitle,
  notePreview,
  pushRevision,
  removeNote,
  restoreDeleted,
  restorePreviousRevision,
  seedFirstRun,
  undoNoticeText,
  updateNoteByAssistant,
  updateNoteByUser,
} from "./notesLogic.ts";

const note = (id, content = id, extra = {}) => ({
  id,
  content,
  updatedLabel: "x",
  ...extra,
});

describe("noteTitle", () => {
  it("uses the first non-empty line", () => {
    assert.equal(noteTitle("\n\n  Hello   world \nsecond"), "Hello world");
  });
  it("falls back for empty / whitespace content", () => {
    assert.equal(noteTitle(""), "Untitled note");
    assert.equal(noteTitle(" \n\t \n"), "Untitled note");
  });
  it("caps a huge first line at 60 chars with an ellipsis", () => {
    const title = noteTitle("a".repeat(54_000));
    assert.equal(title.length, 60);
    assert.ok(title.endsWith("…"));
  });
  it("does not touch a title of exactly 60 chars", () => {
    assert.equal(noteTitle("b".repeat(60)), "b".repeat(60));
  });
});

describe("notePreview", () => {
  it("is the text after the title, collapsed", () => {
    assert.equal(notePreview("Title\n\nline one\nline two"), "line one line two");
  });
  it("has a fallback and caps length", () => {
    assert.equal(notePreview("Title only"), "No additional text");
    assert.ok(notePreview(`T\n${"z".repeat(5000)}`).length <= 120);
  });
});

describe("revisions", () => {
  it("keeps at most MAX_REVISIONS, newest last", () => {
    let revs;
    for (let i = 0; i < 8; i++) revs = pushRevision(revs, `v${i}`);
    assert.equal(revs.length, MAX_REVISIONS);
    assert.deepEqual(revs, ["v3", "v4", "v5", "v6", "v7"]);
  });
  it("ignores empty and repeated bodies", () => {
    assert.deepEqual(pushRevision(["a"], "a"), ["a"]);
    assert.deepEqual(pushRevision(["a"], "  "), ["a"]);
  });
  it("assistant update saves the previous body; restore brings it back", () => {
    const original = note("n", "old body");
    const updated = updateNoteByAssistant(original, "new body", "Just now");
    assert.equal(updated.content, "new body");
    assert.deepEqual(updated.revisions, ["old body"]);
    assert.equal(canRestoreRevision(updated), true);
    const restored = restorePreviousRevision(updated, "Just now");
    assert.equal(restored.content, "old body");
    assert.deepEqual(restored.revisions, []);
    assert.equal(canRestoreRevision(restored), false);
  });
  it("restore with no history is a no-op", () => {
    const n = note("n");
    assert.equal(restorePreviousRevision(n, "Just now"), n);
  });
  it("assistant update with identical content is a no-op", () => {
    const n = note("n", "same");
    assert.equal(updateNoteByAssistant(n, "same", "Just now"), n);
  });
  it("a user edit keeps revisions and clears the sample flag", () => {
    const edited = updateNoteByUser(
      note("n", "a", { sample: true, revisions: ["r"] }),
      "b",
      "Just now",
    );
    assert.equal(edited.sample, undefined);
    assert.deepEqual(edited.revisions, ["r"]);
    assert.equal(edited.content, "b");
  });
});

describe("delete + undo", () => {
  const notes = [note("a"), note("b"), note("c")];
  it("removes and remembers index and author", () => {
    const { notes: rest, deleted } = removeNote(notes, "b", "assistant", 100);
    assert.deepEqual(
      rest.map((n) => n.id),
      ["a", "c"],
    );
    assert.equal(deleted.index, 1);
    assert.equal(deleted.by, "assistant");
  });
  it("unknown id changes nothing", () => {
    const res = removeNote(notes, "zzz", "user", 1);
    assert.equal(res.notes, notes);
    assert.equal(res.deleted, null);
  });
  it("restores at the original position", () => {
    const { notes: rest, deleted } = removeNote(notes, "b", "user", 1);
    assert.deepEqual(
      restoreDeleted(rest, deleted).map((n) => n.id),
      ["a", "b", "c"],
    );
  });
  it("restoring clamps the index and never duplicates", () => {
    const { deleted } = removeNote(notes, "c", "user", 1);
    assert.deepEqual(
      restoreDeleted([note("a")], deleted).map((n) => n.id),
      ["a", "c"],
    );
    assert.equal(restoreDeleted(notes, deleted).length, 3);
  });
  it("undo is active for 10 s only", () => {
    const deleted = { note: note("a"), index: 0, by: "user", at: 1000 };
    assert.equal(isUndoActive(deleted, 1000 + UNDO_WINDOW_MS - 1), true);
    assert.equal(isUndoActive(deleted, 1000 + UNDO_WINDOW_MS), false);
    assert.equal(isUndoActive(null, 1000), false);
  });
  it("notice text distinguishes the assistant", () => {
    assert.equal(undoNoticeText({ by: "assistant" }), "Deleted by the assistant.");
    assert.equal(undoNoticeText({ by: "user" }), "Note deleted.");
  });
});

describe("samples", () => {
  it("seeds once on first run, never again", () => {
    const first = seedFirstRun({ notes: [], samplesSeeded: false });
    assert.equal(first.notes.length, SAMPLE_NOTES.length);
    assert.ok(first.notes.every((n) => n.sample));
    assert.equal(first.samplesSeeded, true);
    const again = { notes: [], samplesSeeded: true };
    assert.equal(seedFirstRun(again), again);
  });
  it("clearSamples removes only samples", () => {
    const mixed = [
      note("mine"),
      ...seedFirstRun({ notes: [], samplesSeeded: false }).notes,
    ];
    assert.deepEqual(
      clearSamples(mixed).map((n) => n.id),
      ["mine"],
    );
    const onlyMine = [note("mine")];
    assert.equal(clearSamples(onlyMine), onlyMine);
  });
  it("migrates a legacy persisted list: tags untouched seeds, keeps user notes", () => {
    const legacy = {
      notes: [
        note("mine", "my note"),
        { id: "grocery-list", content: "edited", updatedLabel: "Just now" },
        { id: "standup", content: "old", updatedLabel: "Aug 12, 2026" },
      ],
    };
    const migrated = migrateNotesState(legacy);
    assert.equal(migrated.samplesSeeded, true);
    assert.equal(migrated.notes[0].sample, undefined);
    assert.equal(migrated.notes[1].sample, undefined);
    assert.equal(migrated.notes[2].sample, true);
  });
  it("migrates garbage to an empty, already-seeded state", () => {
    assert.deepEqual(migrateNotesState(null), { notes: [], samplesSeeded: true });
  });
});
