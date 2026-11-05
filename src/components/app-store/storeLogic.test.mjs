import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { appDetails, detailsFor, sizeLabel } from "./appDetails.ts";
import {
  categoryCounts,
  featuredApps,
  matchApps,
  shortenQuery,
  wrapIndex,
} from "./storeLogic.ts";

const app = (id, extra = {}) => ({
  id,
  name: id,
  tagline: `${id} tagline`,
  developer: "Dev",
  category: "productivity",
  icon: "Kanban",
  ...extra,
});
const apps = [
  app("taskflow", { name: "Taskflow", tagline: "Kanban boards", developer: "Northwind" }),
  app("sched", { category: "utilities", featured: true, developer: "Northwind" }),
  app("wiki", { category: "utilities", featured: true, url: "https://w.test/" }),
];
const categories = [
  { id: "productivity", label: "Productivity" },
  { id: "utilities", label: "Utilities" },
];

describe("matchApps", () => {
  it("matches name, tagline or developer, ignoring case", () => {
    assert.deepEqual(
      matchApps(apps, "KANBAN").map((a) => a.id),
      ["taskflow"],
    );
    assert.equal(matchApps(apps, "northwind").length, 2);
  });
  it("finds nothing for blank text", () => {
    assert.deepEqual(matchApps(apps, "   "), []);
  });
});

describe("shortenQuery", () => {
  it("keeps a normal query and cuts a very long one", () => {
    assert.equal(shortenQuery("task"), "task");
    const cut = shortenQuery("x".repeat(500));
    assert.equal(cut.length, 40);
    assert.ok(cut.endsWith("…"));
  });
});

describe("categoryCounts", () => {
  it("lists All first, then each category with its count", () => {
    assert.deepEqual(categoryCounts(apps, categories), [
      { id: "all", label: "All", count: 3 },
      { id: "productivity", label: "Productivity", count: 1 },
      { id: "utilities", label: "Utilities", count: 2 },
    ]);
  });
});

describe("featuredApps and wrapIndex", () => {
  it("keeps only featured apps", () => {
    assert.deepEqual(
      featuredApps(apps).map((a) => a.id),
      ["sched", "wiki"],
    );
  });
  it("loops either way and survives an empty list", () => {
    assert.equal(wrapIndex(3, 3), 0);
    assert.equal(wrapIndex(-1, 3), 2);
    assert.equal(wrapIndex(1, 3), 1);
    assert.equal(wrapIndex(5, 0), 0);
  });
});

describe("app details", () => {
  // Read as text: importing appCatalog.ts would load the whole icon library into the test.
  const source = readFileSync(new URL("./appCatalog.ts", import.meta.url), "utf8");
  const catalogIds = [...source.matchAll(/^ {4}id: "([^"]+)"/gm)].map((m) => m[1]);

  it("every catalog app has details, and none belongs to an app that is gone", () => {
    assert.ok(catalogIds.length >= 20);
    assert.deepEqual([...catalogIds].sort(), Object.keys(appDetails).sort());
  });
  it("every app has a description and at least one 'what it does' point", () => {
    for (const [id, d] of Object.entries(appDetails)) {
      assert.ok(d.description.length > 0 && d.does.length > 0, id);
    }
  });
  it("labels the size, and says when there is nothing to download", () => {
    assert.equal(
      sizeLabel({}, { description: "", does: [], sizeMb: 62 }),
      "62 MB (example figure)",
    );
    assert.match(
      sizeLabel({ url: "https://x.test/" }, { description: "", does: [] }),
      /Nothing to download/,
    );
    assert.equal(sizeLabel({}, { description: "", does: [] }), "Not listed");
  });
  it("falls back to the tagline for an app without details", () => {
    const d = detailsFor({ id: "new-one", tagline: "Does a thing" });
    assert.equal(d.description, "Does a thing");
    assert.deepEqual(d.does, []);
  });
});
