import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_RECENTS, addRecent, parseRecents } from "./browserRecents.ts";
import {
  MAX_TABS,
  activeTab,
  closeTab,
  createTabs,
  currentEntry,
  entryAddress,
  goBack,
  goForward,
  openTab,
  pushEntry,
  reloadTab,
  selectTab,
  tabTitle,
  updateTab,
} from "./browserTabs.ts";

const home = { kind: "mock", id: "home" };
const url = (u) => ({ kind: "url", url: u });

describe("tabs", () => {
  it("opens a tab after the active one and makes it active", () => {
    let s = createTabs("a", home);
    s = openTab(s, "b", { kind: "newtab" });
    s = selectTab(s, "a");
    s = openTab(s, "c", { kind: "newtab" });
    assert.deepEqual(
      s.tabs.map((t) => t.id),
      ["a", "c", "b"],
    );
    assert.equal(s.activeId, "c");
  });
  it("stops opening tabs at the limit", () => {
    let s = createTabs("t0", home);
    for (let i = 1; i < MAX_TABS + 3; i++) s = openTab(s, `t${i}`, { kind: "newtab" });
    assert.equal(s.tabs.length, MAX_TABS);
  });
  it("closing the active tab activates its neighbour; closing another keeps the active one", () => {
    let s = createTabs("a", home);
    s = openTab(s, "b", { kind: "newtab" });
    s = openTab(s, "c", { kind: "newtab" });
    s = closeTab(s, "c", "z");
    assert.equal(s.activeId, "b");
    s = selectTab(s, "a");
    s = closeTab(s, "b", "z");
    assert.deepEqual([s.tabs.map((t) => t.id), s.activeId], [["a"], "a"]);
  });
  it("closing the only tab leaves a fresh new-tab page", () => {
    const s = closeTab(createTabs("a", home), "a", "z");
    assert.equal(s.tabs.length, 1);
    assert.equal(s.activeId, "z");
    assert.equal(currentEntry(activeTab(s)).kind, "newtab");
  });
  it("ignores an unknown tab", () => {
    const s = createTabs("a", home);
    assert.equal(closeTab(s, "nope", "z"), s);
    assert.equal(selectTab(s, "nope"), s);
  });
  it("gives each tab its own history", () => {
    let s = createTabs("a", home);
    s = openTab(s, "b", { kind: "newtab" });
    s = updateTab(s, "b", (t) => pushEntry(t, url("https://example.com/")));
    assert.equal(activeTab(s).history.length, 2);
    assert.equal(s.tabs[0].history.length, 1);
  });
});

describe("tab history", () => {
  it("goes back and forward within bounds and drops the forward pages on a new one", () => {
    let t = createTabs("a", home).tabs[0];
    t = pushEntry(pushEntry(t, url("https://a.test/")), url("https://b.test/"));
    t = goBack(goBack(goBack(t)));
    assert.equal(t.index, 0);
    t = goForward(t);
    t = pushEntry(t, url("https://c.test/"));
    assert.deepEqual(
      t.history.map((e) => e.kind === "url" && e.url),
      [false, "https://a.test/", "https://c.test/"],
    );
    assert.equal(goForward(t).index, t.index);
  });
  it("reload only counts up", () => {
    const t = createTabs("a", home).tabs[0];
    assert.equal(reloadTab(reloadTab(t)).reloads, 2);
  });
});

describe("titles and addresses", () => {
  it("names a tab by its page", () => {
    assert.equal(tabTitle(home), "Pathfinder");
    assert.equal(tabTitle({ kind: "newtab" }), "New tab");
    assert.equal(tabTitle(url("https://www.example.com/a?b=1")), "example.com");
    assert.equal(
      tabTitle({ kind: "search", url: "u", query: "q".repeat(40) }).length,
      24,
    );
  });
  it("shows no address on the new-tab page", () => {
    assert.equal(entryAddress({ kind: "newtab" }), "");
    assert.equal(entryAddress(home), "pathfinder://home");
    assert.equal(entryAddress(url("https://a.test/")), "https://a.test/");
  });
});

describe("recent sites", () => {
  it("puts the newest first, one per site, with the latest address", () => {
    let list = addRecent([], "https://www.example.com/a", 1);
    list = addRecent(list, "https://other.test/", 2);
    list = addRecent(list, "https://example.com/b", 3);
    assert.deepEqual(
      list.map((s) => [s.host, s.url]),
      [
        ["example.com", "https://example.com/b"],
        ["other.test", "https://other.test/"],
      ],
    );
  });
  it("keeps at most eight and ignores addresses that are not web pages", () => {
    let list = [];
    for (let i = 0; i < 12; i++) list = addRecent(list, `https://site${i}.test/`, i);
    assert.equal(list.length, MAX_RECENTS);
    assert.equal(list[0].host, "site11.test");
    assert.equal(addRecent(list, "pathfinder://home", 99).length, MAX_RECENTS);
    assert.equal(addRecent(list, "javascript:alert(1)", 99)[0].host, "site11.test");
  });
  it("reads a saved list defensively", () => {
    assert.deepEqual(parseRecents(null), []);
    assert.deepEqual(parseRecents("not json"), []);
    assert.deepEqual(parseRecents('{"a":1}'), []);
    const saved = JSON.stringify([
      { url: "https://a.test/", at: 5 },
      { url: "javascript:alert(1)", at: 6 },
      { url: "https://www.a.test/x", at: 7 },
      null,
      { url: 3 },
      { url: "https://b.test/", at: "x" },
    ]);
    assert.deepEqual(
      parseRecents(saved).map((s) => [s.host, s.at]),
      [
        ["a.test", 5],
        ["b.test", 0],
      ],
    );
  });
});
