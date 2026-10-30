// Run with `pnpm test`. Template packs, versions, tags and variants, usage text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPack, readPack } from "./pack.ts";
import {
  checkInput,
  cleanTags,
  cleanVariants,
  createTemplate,
  emptyLibrary,
  parseLibrary,
  updateTemplate,
} from "./library.ts";
import { lastUsedText, markUsed, sanitizeUsage } from "./usage.ts";

const NOW = "2026-10-30T10:00:00.000Z";
const input = (over = {}) => ({
  name: "Status mail",
  kind: "email",
  description: "",
  subject: "Status {{title}}",
  to: "",
  cc: "",
  body: "Hi\n\n{{> signature}}",
  usedBy: [],
  ...over,
});

describe("tags and variants", () => {
  it("cleans tags: distinct, short, capped", () => {
    assert.deepEqual(cleanTags([" Client ", "client", "", "x".repeat(50), 5]), [
      "Client",
      "x".repeat(30),
    ]);
    assert.equal(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 8);
    assert.deepEqual(cleanTags("nope"), []);
  });
  it("cleans variants: a label and text are needed, ids are unique", () => {
    const v = cleanVariants([
      { id: "client", label: "Client", subject: "S", body: "Dear client" },
      { id: "client", label: "Dupe", body: "x" },
      { label: "", body: "x" },
      { label: "Team", body: "" },
      { label: "Team", body: "Hi team" },
    ]);
    assert.deepEqual(
      v.map((x) => x.id),
      ["client", "v2"],
    );
    assert.equal(v[1].label, "Team");
  });
  it("accepts them in an edit and leaves them out when not sent", () => {
    const checked = checkInput(
      input({ tags: ["a", "A"], variants: [{ label: "L", body: "B" }] }),
    );
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.value.tags, ["a"]);
    assert.equal(checkInput(input()).value.tags, undefined);
    assert.equal(checkInput(input({ kind: "snippet", body: "Thanks" })).ok, true);
  });
});

describe("version history", () => {
  it("keeps the earlier state when the text changes, newest first, and not when it does not", () => {
    let lib = emptyLibrary();
    const made = createTemplate(
      lib,
      input({ tags: ["x"] }),
      "2026-10-01T00:00:00.000Z",
      "tpl_aaaaaaaaaaaa",
    );
    lib = made.library;
    const edited = updateTemplate(
      lib,
      "tpl_aaaaaaaaaaaa",
      input({ body: "Hello\n\n{{> signature}}" }),
      "2026-10-02T00:00:00.000Z",
    );
    assert.equal(edited.template.history.length, 1);
    assert.equal(edited.template.history[0].body, "Hi\n\n{{> signature}}");
    assert.equal(edited.template.history[0].at, "2026-10-01T00:00:00.000Z");
    assert.deepEqual(edited.template.tags, ["x"]); // left out of the edit: kept
    const same = updateTemplate(
      edited.library,
      "tpl_aaaaaaaaaaaa",
      input({ body: "Hello\n\n{{> signature}}" }),
      NOW,
    );
    assert.equal(same.template.history.length, 1);
    const again = updateTemplate(
      same.library,
      "tpl_aaaaaaaaaaaa",
      input({ body: "Third", tags: [] }),
      NOW,
    );
    assert.equal(again.template.history.length, 2);
    assert.equal(again.template.history[0].body, "Hello\n\n{{> signature}}");
    assert.equal(again.template.tags, undefined);
  });
  it("caps the history at 20", () => {
    let lib = createTemplate(emptyLibrary(), input(), NOW, "tpl_aaaaaaaaaaaa").library;
    for (let i = 0; i < 30; i++)
      lib = updateTemplate(
        lib,
        "tpl_aaaaaaaaaaaa",
        input({ body: `v${i}` }),
        NOW,
      ).library;
    assert.equal(lib.templates[0].history.length, 20);
  });
  it("survives a read of the saved file", () => {
    const lib = createTemplate(
      emptyLibrary(),
      input({ variants: [{ id: "c", label: "C", body: "B" }] }),
      NOW,
      "tpl_aaaaaaaaaaaa",
    ).library;
    const edited = updateTemplate(
      lib,
      "tpl_aaaaaaaaaaaa",
      input({ body: "Next" }),
      NOW,
    ).library;
    const read = parseLibrary(JSON.parse(JSON.stringify(edited)));
    assert.equal(read.templates[0].history.length, 1);
    assert.equal(read.templates[0].variants[0].id, "c");
  });
});

describe("packs", () => {
  const lib = (() => {
    let l = emptyLibrary();
    l = createTemplate(l, input({ usedBy: [] }), NOW, "tpl_aaaaaaaaaaaa").library;
    l = createTemplate(
      l,
      input({ name: "Signature", kind: "snippet", subject: "", body: "Thanks" }),
      NOW,
      "tpl_bbbbbbbbbbbb",
    ).library;
    l = createTemplate(
      l,
      input({ name: "Other", body: "x" }),
      NOW,
      "tpl_cccccccccccc",
    ).library;
    return l.templates;
  })();
  it("exports the chosen templates and the snippets they use, with no places", () => {
    const pack = buildPack(lib, ["tpl_aaaaaaaaaaaa"], NOW);
    assert.deepEqual(
      pack.templates.map((t) => t.name),
      ["Status mail", "Signature"],
    );
    assert.ok(pack.templates.every((t) => t.usedBy.length === 0));
  });
  it("imports under free names and reports what it skipped", () => {
    const pack = buildPack(lib, ["tpl_aaaaaaaaaaaa"], NOW);
    pack.templates.push({ name: "", kind: "email", body: "", usedBy: [] });
    const read = readPack(JSON.stringify(pack), [
      "Status mail",
      "Status mail (imported)",
    ]);
    assert.equal(read.ok, true);
    assert.deepEqual(
      read.templates.map((t) => t.name),
      ["Status mail (imported 2)", "Signature"],
    );
    assert.equal(read.skipped.length, 1);
  });
  it("refuses a file that is not a pack", () => {
    assert.equal(readPack("{ nope", []).ok, false);
    assert.equal(readPack(JSON.stringify({ format: "x" }), []).ok, false);
    assert.equal(
      readPack(
        JSON.stringify({ format: "ai-os-template-pack", version: 9, templates: [] }),
        [],
      ).ok,
      false,
    );
    assert.equal(
      readPack(
        JSON.stringify({
          format: "ai-os-template-pack",
          version: 1,
          templates: [{ name: "" }],
        }),
        [],
      ).ok,
      false,
    );
  });
});

describe("usage", () => {
  it("keeps valid entries and words the age", () => {
    const u = sanitizeUsage({
      tpl_aaaaaaaa: "2026-10-30T09:00:00Z",
      bad: "2026-10-30T09:00:00Z",
      tpl_bbbbbbbb: "nope",
    });
    assert.deepEqual(Object.keys(u), ["tpl_aaaaaaaa"]);
    const now = new Date("2026-10-30T10:00:00Z");
    assert.equal(lastUsedText(undefined, now), "No draft yet");
    assert.equal(lastUsedText("2026-10-30T09:00:00Z", now), "Last made a draft 1 h ago");
    assert.equal(
      lastUsedText("2026-10-27T10:00:00Z", now),
      "Last made a draft 3 days ago",
    );
    assert.equal(lastUsedText("2026-10-30T09:59:40Z", now), "Made a draft just now");
    assert.equal(markUsed(u, "tpl_aaaaaaaa", "2026-10-30T09:00:00Z"), u);
  });
});
