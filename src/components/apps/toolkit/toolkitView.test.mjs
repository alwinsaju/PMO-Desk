import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_TOOL_KEY,
  PINNED_GROUP_TITLE,
  PINNED_KEY,
  arrangeGroups,
  filterTools,
  loadToolkitMemory,
  saveLastTool,
  savePinned,
  sanitizeLastTool,
  sanitizePinned,
  togglePin,
} from "./toolkitView.ts";

const tools = [
  {
    id: "raid",
    title: "RAID log",
    blurb: "Risks, assumptions, issues and dependencies.",
  },
  { id: "decisions", title: "Decision log", blurb: "What was decided, by whom." },
  { id: "vendors", title: "Vendor tracker", blurb: "Contracts and renewals." },
];
const ids = tools.map((t) => t.id);
const groups = [
  { title: "Risks", tools: [tools[0], tools[1]] },
  { title: "Money", tools: [tools[2]] },
];

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}
const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

test("filterTools: blank query keeps every tool", () => {
  assert.equal(filterTools(tools, "").length, 3);
  assert.equal(filterTools(tools, "   ").length, 3);
});

test("filterTools: matches the title or the blurb, ignoring case", () => {
  assert.deepEqual(
    filterTools(tools, "raid").map((t) => t.id),
    ["raid"],
  );
  assert.deepEqual(
    filterTools(tools, "RENEWALS").map((t) => t.id),
    ["vendors"],
  );
  assert.deepEqual(
    filterTools(tools, "decided").map((t) => t.id),
    ["decisions"],
  );
});

test("filterTools: every word must match, in any order; no match gives an empty list", () => {
  assert.deepEqual(
    filterTools(tools, "log decision").map((t) => t.id),
    ["decisions"],
  );
  assert.deepEqual(filterTools(tools, "log zebra"), []);
});

test("filterTools: a tool with no blurb still matches by title", () => {
  assert.equal(filterTools([{ id: "x", title: "Thing" }], "thing").length, 1);
});

test("sanitizePinned: keeps known ids once, in stored order", () => {
  assert.deepEqual(sanitizePinned(["vendors", "gone", "raid", "vendors", 5, null], ids), [
    "vendors",
    "raid",
  ]);
});

test("sanitizePinned: non-arrays give an empty list", () => {
  for (const bad of [null, undefined, "raid", 3, { 0: "raid" }]) {
    assert.deepEqual(sanitizePinned(bad, ids), []);
  }
});

test("sanitizeLastTool: only a known id survives", () => {
  assert.equal(sanitizeLastTool("raid", ids), "raid");
  assert.equal(sanitizeLastTool("gone", ids), null);
  assert.equal(sanitizeLastTool(null, ids), null);
  assert.equal(sanitizeLastTool(["raid"], ids), null);
});

test("togglePin: pins at the end, unpins, and does not mutate", () => {
  const start = ["raid"];
  assert.deepEqual(togglePin(start, "vendors"), ["raid", "vendors"]);
  assert.deepEqual(togglePin(start, "raid"), []);
  assert.deepEqual(start, ["raid"]);
});

test("arrangeGroups: no pins leaves the groups as they are", () => {
  assert.deepEqual(arrangeGroups(groups, []), groups);
});

test("arrangeGroups: pinned tools lead in pin order and leave their own groups", () => {
  const out = arrangeGroups(groups, ["vendors", "raid"]);
  assert.deepEqual(
    out.map((g) => g.title),
    [PINNED_GROUP_TITLE, "Risks"],
  );
  assert.deepEqual(
    out[0].tools.map((t) => t.id),
    ["vendors", "raid"],
  );
  assert.deepEqual(
    out[1].tools.map((t) => t.id),
    ["decisions"],
  );
});

test("arrangeGroups: a pin the filter removed is not shown, and empty groups are hidden", () => {
  const filtered = [{ title: "Money", tools: [tools[2]] }];
  const out = arrangeGroups(filtered, ["raid"]);
  assert.deepEqual(
    out.map((g) => g.title),
    ["Money"],
  );
  assert.deepEqual(arrangeGroups([], ["raid"]), []);
});

test("loadToolkitMemory: reads and sanitises what was saved", () => {
  const storage = fakeStorage({
    [PINNED_KEY]: JSON.stringify(["vendors", "gone", "raid"]),
    [LAST_TOOL_KEY]: "decisions",
  });
  assert.deepEqual(loadToolkitMemory(storage, ids), {
    pinned: ["vendors", "raid"],
    last: "decisions",
  });
});

test("loadToolkitMemory: bad JSON, an unknown last tool, no storage or a throwing one fall back safely", () => {
  const empty = { pinned: [], last: null };
  assert.deepEqual(
    loadToolkitMemory(
      fakeStorage({ [PINNED_KEY]: "{not json", [LAST_TOOL_KEY]: "gone" }),
      ids,
    ),
    empty,
  );
  assert.deepEqual(loadToolkitMemory(null, ids), empty);
  assert.deepEqual(loadToolkitMemory(throwing, ids), empty);
  assert.deepEqual(loadToolkitMemory(fakeStorage(), ids), empty);
});

test("savePinned and saveLastTool: round trip, and a throwing or missing storage returns false", () => {
  const storage = fakeStorage();
  assert.equal(savePinned(storage, ["raid", "vendors"]), true);
  assert.equal(saveLastTool(storage, "raid"), true);
  assert.deepEqual(loadToolkitMemory(storage, ids), {
    pinned: ["raid", "vendors"],
    last: "raid",
  });
  assert.equal(savePinned(throwing, ["raid"]), false);
  assert.equal(saveLastTool(throwing, "raid"), false);
  assert.equal(savePinned(null, ["raid"]), false);
  assert.equal(saveLastTool(null, "raid"), false);
});
