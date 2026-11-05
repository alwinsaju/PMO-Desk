import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_REVISIONS,
  SAMPLE_NOTES,
  UNDO_WINDOW_MS,
  canRestoreRevision,
  clearSamples,
  filterByTag,
  filterNotes,
  isUndoActive,
  migrateNotesState,
  noteMatchesText,
  noteTags,
  noteTitle,
  noteListEntry,
  noteDateLabel,
  noteSaveIndicator,
  notePreview,
  orderNotes,
  pushRevision,
  removeNote,
  restoreDeleted,
  restorePreviousRevision,
  seedFirstRun,
  tagCounts,
  togglePinned,
  undoNoticeText,
  updateNoteByAssistant,
  updateNoteByUser,
  visibleNotes,
  wordCount,
  SPELLCHECK_MAX_CHARS,
  spellcheckEnabled,
} from "./notesLogic.ts";

const AT = "2026-11-05T09:30:00.000Z";

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
  it("drops a leading list marker so it does not read as a stray dash", () => {
    assert.equal(
      notePreview("Standup\n- Shipped the build\n- Fixed bug"),
      "Shipped the build - Fixed bug",
    );
    assert.equal(notePreview("T\n• First"), "First");
  });
  it("has no filler for a title-only note and caps length", () => {
    assert.equal(notePreview("Title only"), "");
    assert.ok(notePreview(`T\n${"z".repeat(5000)}`).length <= 120);
  });
  it("continues a cut title in the preview", () => {
    const content =
      "Sprint review prep - agenda: velocity, blockers, demo; call the client";
    assert.equal(noteTitle(content, 30), "Sprint review prep - agenda:…");
    assert.equal(notePreview(content, 30), "velocity, blockers, demo; call the client");
    assert.equal(
      notePreview(`${content}\nSecond line`, 30).endsWith("Second line"),
      true,
    );
  });
  it("cuts a single long token mid-word", () => {
    const entry = noteListEntry("x".repeat(80));
    assert.equal(entry.title.length, 30);
    assert.ok(entry.preview.length > 0);
  });
});

describe("noteListEntry / noteDateLabel", () => {
  it("shows a short one-line note as the title alone", () => {
    assert.deepEqual(noteListEntry("Buy milk"), { title: "Buy milk", preview: "" });
  });
  it("hides the date of sample notes only", () => {
    assert.equal(noteDateLabel({ sample: true, updatedLabel: "Aug 25, 2026" }), "");
    assert.equal(noteDateLabel({ updatedLabel: "Aug 25, 2026" }), "Aug 25, 2026");
  });
  it("says the date is unknown for the old fixed 'Just now' label", () => {
    assert.equal(noteDateLabel({ updatedLabel: "Just now" }), "Date unknown");
    assert.equal(noteDateLabel({}), "Date unknown");
    assert.equal(noteDateLabel({ updatedAt: "garbage" }), "Date unknown");
  });
  it("formats a real timestamp relative to now", () => {
    const now = new Date(2026, 10, 5, 15, 0, 0);
    const at = (...parts) => new Date(...parts).toISOString();
    const label = (iso) => noteDateLabel({ updatedAt: iso }, now);
    assert.equal(label(at(2026, 10, 5, 14, 59, 40)), "Just now");
    assert.equal(label(at(2026, 10, 5, 9, 5)), "Today, 09:05");
    assert.equal(label(at(2026, 10, 4, 23, 30)), "Yesterday, 23:30");
    assert.equal(label(at(2026, 9, 20, 8, 0)), "Oct 20, 08:00");
    assert.equal(label(at(2025, 11, 31, 8, 0)), "Dec 31, 2025");
  });
  it("is real: an edit stamps the time and drops the old label", () => {
    const edited = updateNoteByUser(
      note("a", "x", { updatedLabel: "Just now" }),
      "y",
      AT,
    );
    assert.equal(edited.updatedAt, AT);
    assert.equal(edited.updatedLabel, undefined);
  });
});

describe("noteSaveIndicator", () => {
  it("says Saved only when the server has the text", () => {
    assert.equal(noteSaveIndicator({ state: "saving" }).text, "Saving…");
    assert.equal(noteSaveIndicator({ state: "saved" }).kind, "saved");
  });
  it("explains each failure in plain words", () => {
    const big = noteSaveIndicator({
      state: "error",
      failure: "too-large",
      willRetry: false,
    });
    assert.equal(big.kind, "error");
    assert.match(big.detail, /too big/);
    const down = noteSaveIndicator({
      state: "error",
      failure: "unreachable",
      willRetry: true,
    });
    assert.equal(down.kind, "error");
    assert.match(down.text, /retrying/);
    const refused = noteSaveIndicator({
      state: "error",
      failure: "rejected",
      willRetry: false,
    });
    assert.equal(refused.text, "Not saved");
  });
});

describe("visibleNotes", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
  it("shows the first page and counts what is hidden", () => {
    const { shown, hidden } = visibleNotes(list, 4, null);
    assert.equal(shown.length, 4);
    assert.equal(hidden, 6);
  });
  it("widens to include the selected note", () => {
    const { shown, hidden } = visibleNotes(list, 4, "6");
    assert.equal(shown.length, 7);
    assert.equal(hidden, 3);
    assert.equal(visibleNotes(list, 50, null).hidden, 0);
  });
});

describe("derived note data is cached per note", () => {
  it("still reflects a replaced note", () => {
    const a = note("a", "alpha #one");
    assert.deepEqual(tagCounts([a]), [{ tag: "one", count: 1 }]);
    assert.equal(noteMatchesText(a, "ALPHA"), true);
    const b = { ...a, content: "beta #two" };
    assert.deepEqual(tagCounts([b]), [{ tag: "two", count: 1 }]);
    assert.equal(noteMatchesText(b, "alpha"), false);
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
    const updated = updateNoteByAssistant(original, "new body", AT);
    assert.equal(updated.content, "new body");
    assert.deepEqual(updated.revisions, ["old body"]);
    assert.equal(canRestoreRevision(updated), true);
    const restored = restorePreviousRevision(updated, AT);
    assert.equal(restored.content, "old body");
    assert.deepEqual(restored.revisions, []);
    assert.equal(canRestoreRevision(restored), false);
  });
  it("restore with no history is a no-op", () => {
    const n = note("n");
    assert.equal(restorePreviousRevision(n, AT), n);
  });
  it("assistant update with identical content is a no-op", () => {
    const n = note("n", "same");
    assert.equal(updateNoteByAssistant(n, "same", AT), n);
  });
  it("a user edit keeps revisions and clears the sample flag", () => {
    const edited = updateNoteByUser(
      note("n", "a", { sample: true, revisions: ["r"] }),
      "b",
      AT,
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

describe("pinning and ordering", () => {
  it("toggles a pin on and off without touching the rest", () => {
    const n = note("a", "x", { updatedLabel: "Aug" });
    const pinned = togglePinned(n);
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.updatedLabel, "Aug");
    assert.equal("pinned" in togglePinned(pinned), false);
  });
  it("lists pinned notes first and keeps each group's order", () => {
    const notes = [
      note("a"),
      note("b", "b", { pinned: true }),
      note("c"),
      note("d", "d", { pinned: true }),
    ];
    const { pinned, others } = orderNotes(notes);
    assert.deepEqual(
      pinned.map((n) => n.id),
      ["b", "d"],
    );
    assert.deepEqual(
      others.map((n) => n.id),
      ["a", "c"],
    );
  });
  it("keeps the pin when a person edits the note", () => {
    const edited = updateNoteByUser(note("a", "x", { pinned: true }), "y", AT);
    assert.equal(edited.pinned, true);
  });
});

describe("tags", () => {
  it("finds #tags anywhere, lower-cased and unique, but not headings", () => {
    assert.deepEqual(
      noteTags("# Plan\nCall #Client and #client, then #q4-review.\n##x #1"),
      ["client", "q4-review"],
    );
    assert.deepEqual(noteTags("no tags a#b"), []);
  });
  it("counts notes per tag, most used first, and filters by one", () => {
    const notes = [note("a", "x #work #home"), note("b", "y #work"), note("c", "z")];
    assert.deepEqual(tagCounts(notes), [
      { tag: "work", count: 2 },
      { tag: "home", count: 1 },
    ]);
    assert.deepEqual(
      filterByTag(notes, "work").map((n) => n.id),
      ["a", "b"],
    );
    assert.equal(filterByTag(notes, null).length, 3);
    assert.equal(filterByTag(notes, "missing").length, 0);
  });
});

describe("formatting markers in titles, previews and word counts", () => {
  it("shows a heading or bold title as plain text", () => {
    assert.equal(noteTitle("# Weekly plan\nbody"), "Weekly plan");
    assert.equal(noteTitle("**Important** call"), "Important call");
    assert.equal(
      notePreview("T\n- [ ] call Priya\n- [x] send deck"),
      "call Priya send deck",
    );
  });
  it("counts words without markers or bullets", () => {
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("  \n "), 0);
    assert.equal(wordCount("# Plan\n- one two\n- [ ] three **four**"), 5);
  });
});

describe("text filter", () => {
  const notes = [
    note("a", "# Weekly Plan\nCall Priya about the budget #work"),
    note("b", "Shopping list\nmilk, eggs #home"),
    note("c", "**Budget** review notes #work"),
  ];
  it("matches the title and the body, ignoring case", () => {
    assert.equal(noteMatchesText(notes[0], "weekly"), true);
    assert.equal(noteMatchesText(notes[0], "PRIYA"), true);
    assert.equal(noteMatchesText(notes[1], "priya"), false);
  });
  it("needs every word, in any order", () => {
    assert.equal(noteMatchesText(notes[0], "budget call"), true);
    assert.equal(noteMatchesText(notes[0], "budget milk"), false);
  });
  it("sees through formatting markers", () => {
    assert.equal(noteMatchesText(notes[0], "weekly plan"), true);
    assert.equal(noteMatchesText(notes[2], "budget review"), true);
  });
  it("matches everything for a blank query", () => {
    assert.equal(noteMatchesText(notes[1], ""), true);
    assert.equal(noteMatchesText(notes[1], "   "), true);
    assert.equal(filterNotes(notes, null, "").length, 3);
  });
  it("combines with the tag filter: both must hold", () => {
    assert.deepEqual(
      filterNotes(notes, null, "budget").map((n) => n.id),
      ["a", "c"],
    );
    assert.deepEqual(
      filterNotes(notes, "work", "review").map((n) => n.id),
      ["c"],
    );
    assert.deepEqual(
      filterNotes(notes, "home", "budget").map((n) => n.id),
      [],
    );
    assert.deepEqual(
      filterNotes(notes, "home", "").map((n) => n.id),
      ["b"],
    );
  });
});

describe("spellcheckEnabled", () => {
  it("keeps the spell checker for normal notes and turns it off for huge ones", () => {
    assert.equal(spellcheckEnabled("a short note"), true);
    assert.equal(spellcheckEnabled("x".repeat(SPELLCHECK_MAX_CHARS)), true);
    assert.equal(spellcheckEnabled("x".repeat(SPELLCHECK_MAX_CHARS + 1)), false);
  });
});
