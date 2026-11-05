// Run with `pnpm test`. Search across Settings and its index.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SETTINGS_INDEX, TAB_TITLES, pathOf, searchSettings } from "./settingsIndex.ts";

describe("searchSettings", () => {
  it("finds a setting by a word of its title, best match first", () => {
    const found = searchSettings("lock");
    assert.deepEqual(
      found.slice(0, 2).map((s) => s.id),
      ["instant-unlock", "lock-summary"],
    );
    assert.ok(found.every((s) => s.tab === "general"));
  });

  it("matches hints, keywords and the section name, all words required", () => {
    assert.equal(searchSettings("zip")[0].id, "backup-now");
    assert.ok(searchSettings("colorblind").some((s) => s.id === "colour-blind-roster"));
    assert.ok(searchSettings("restore backup").some((s) => s.id === "restore"));
    assert.equal(searchSettings("lock banana").length, 0);
  });

  it("matches nothing for an empty query", () => {
    assert.deepEqual(searchSettings("  "), []);
  });

  it("finds settings that live in the Quick settings menu or PMO To-Do and says so (SH-13)", () => {
    for (const [query, id] of [
      ["tray", "keep-running-in-tray"],
      ["hardware acceleration", "hardware-acceleration"],
      ["quick capture", "quick-capture"],
      ["fast ai model", "fast-model"],
    ]) {
      const found = searchSettings(query);
      assert.equal(found[0]?.id, id, query);
      assert.ok(found[0].elsewhere, `${id} is not a row of the Settings window`);
      assert.equal(pathOf(found[0]), found[0].elsewhere);
    }
  });

  it("shows where a setting lives", () => {
    const item = SETTINGS_INDEX.find((s) => s.id === "lock-summary");
    assert.equal(pathOf(item), "General › Lock screen and desktop");
    assert.equal(
      pathOf(SETTINGS_INDEX.find((s) => s.id === "command-history")),
      "General › Command history",
    );
  });
});

describe("the index", () => {
  it("has unique ids and a known tab for every entry", () => {
    const ids = SETTINGS_INDEX.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SETTINGS_INDEX) {
      assert.ok(TAB_TITLES[s.tab], s.id);
      assert.ok(s.title && s.section && s.hint, s.id);
    }
  });

  it("only lists settings that exist on screen", () => {
    const dir = fileURLToPath(
      new URL("../../components/apps/settings-app/", import.meta.url),
    );
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => readFileSync(dir + f, "utf8"))
      .join("\n");
    for (const s of SETTINGS_INDEX) {
      if (s.elsewhere) continue;
      const literal = [`settingId="${s.id}"`, `data-setting-id="${s.id}"`];
      const computed =
        s.id.startsWith("confirm-") && source.includes("settingId={`confirm-${key}`}");
      assert.ok(
        literal.some((text) => source.includes(text)) || computed,
        `no row has settingId "${s.id}"`,
      );
    }
  });
});
