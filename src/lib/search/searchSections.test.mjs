// Run with `pnpm test`. Ctrl+K: grouped sections, recents and match highlighting.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { highlightParts } from "./highlight.ts";
import {
  MAX_RECENTS,
  pushRecent,
  resolveRecents,
  sanitizeRecents,
} from "./recentSearches.ts";
import { buildSections, flattenSections } from "./searchSections.ts";

const item = (kind, id, title, extra = {}) => ({
  id: `${kind}:${id}`,
  kind,
  title,
  subtitle: "",
  keywords: "",
  target: { app: "notes" },
  ...extra,
});

const catalog = [
  item("note", "1", "Report ideas"),
  item("app", "dash", "Dashboard"),
  item("app", "pmo", "PMO To-Do"),
  item("person", "p", "Priya Reporter"),
  item("todo", "t", "Send weekly report"),
  item("timeoff", "o", "Priya: Annual leave, report week"),
  item("template", "m", "Report chaser"),
  item("record", "r", "Risk: report slips"),
];

describe("buildSections", () => {
  it("groups a query in the agreed order with headers", () => {
    const sections = buildSections(catalog, "report", []);
    assert.deepEqual(
      sections.map((s) => s.label),
      ["People", "To-dos", "Templates", "Records", "Notes", "Time off"],
    );
    assert.ok(sections.every((s) => s.items.length > 0));
  });

  it("keeps the ranking inside a group and flattens in screen order", () => {
    const flat = flattenSections(buildSections(catalog, "report", []));
    assert.equal(flat.length, 6);
    assert.deepEqual(
      flat.map((i) => i.kind),
      ["person", "todo", "template", "record", "note", "timeoff"],
    );
  });

  it("omits groups with no matches", () => {
    const sections = buildSections(catalog, "dashboard", []);
    assert.deepEqual(
      sections.map((s) => s.id),
      ["app"],
    );
  });

  it("an empty query leads with Recent, then the apps not already in it", () => {
    const recents = [catalog[2], catalog[4]];
    const sections = buildSections(catalog, "  ", recents);
    assert.deepEqual(
      sections.map((s) => s.label),
      ["Recent", "Apps"],
    );
    assert.deepEqual(
      sections[1].items.map((i) => i.title),
      ["Dashboard"],
    );
  });

  it("an empty query with no recents is just the apps", () => {
    const sections = buildSections(catalog, "", []);
    assert.deepEqual(
      sections.map((s) => s.id),
      ["app"],
    );
  });
});

describe("recent items", () => {
  it("puts the newest first, moves a repeat to the front and caps at five", () => {
    let list = [];
    for (const n of [1, 2, 3, 4, 5, 6])
      list = pushRecent(list, item("app", n, `App ${n}`));
    assert.equal(list.length, MAX_RECENTS);
    assert.equal(list[0].id, "app:6");
    list = pushRecent(list, item("app", 3, "App 3"));
    assert.deepEqual(
      list.map((i) => i.id),
      ["app:3", "app:6", "app:5", "app:4", "app:2"],
    );
  });

  it("drops the matching keywords from what is saved", () => {
    const [saved] = pushRecent([], item("note", "n", "N", { keywords: "long text" }));
    assert.equal(saved.keywords, "");
  });

  it("reads a saved list defensively", () => {
    assert.deepEqual(sanitizeRecents("nope"), []);
    const good = item("todo", "a", "A");
    const out = sanitizeRecents([
      good,
      good,
      { id: "x" },
      null,
      { ...good, id: "todo:b", kind: "bogus" },
      { ...good, id: "todo:c", target: null },
    ]);
    assert.deepEqual(
      out.map((i) => i.id),
      ["todo:a"],
    );
  });

  it("prefers the live item, keeps the saved one while loading, drops a deleted one once loaded", () => {
    const saved = [
      item("todo", "a", "Old title"),
      item("todo", "b", "B"),
      item("app", "x", "X"),
    ];
    const live = [item("todo", "a", "New title")];
    assert.deepEqual(
      resolveRecents(saved, live, new Set(["app"])).map((i) => i.title),
      ["New title", "B"],
    );
    assert.deepEqual(
      resolveRecents(saved, live, new Set(["app", "todo"])).map((i) => i.title),
      ["New title"],
    );
  });
});

describe("highlightParts", () => {
  it("marks every typed word, ignoring case", () => {
    assert.deepEqual(highlightParts("Send weekly Report", "report send"), [
      { text: "Send", match: true },
      { text: " weekly ", match: false },
      { text: "Report", match: true },
    ]);
  });

  it("returns the text whole when nothing matches or the query is empty", () => {
    assert.deepEqual(highlightParts("Notes", "zzz"), [{ text: "Notes", match: false }]);
    assert.deepEqual(highlightParts("Notes", "  "), [{ text: "Notes", match: false }]);
    assert.deepEqual(highlightParts("", "a"), [{ text: "", match: false }]);
  });

  it("treats regex characters as plain text", () => {
    assert.deepEqual(highlightParts("a (b) c", "(b)"), [
      { text: "a ", match: false },
      { text: "(b)", match: true },
      { text: " c", match: false },
    ]);
  });

  it("prefers the longest word when words overlap", () => {
    assert.deepEqual(highlightParts("reporting", "report reporting"), [
      { text: "reporting", match: true },
    ]);
  });
});
