import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boldSegments,
  placeholdersIn,
  renderFields,
  renderText,
  tidyText,
  unknownPlaceholders,
} from "./render.ts";
import {
  checkInput,
  createTemplate,
  deleteTemplate,
  emptyLibrary,
  parseLibrary,
  starterLibrary,
  templateFor,
  updateTemplate,
} from "./library.ts";
import { STARTERS } from "./starters.ts";
import { allowedPlaceholders, sampleValues, TARGETS, targetByKey } from "./targets.ts";

const NOW = "2026-10-30T10:00:00.000Z";
const LATER = "2026-10-31T10:00:00.000Z";

const input = (over = {}) => ({
  name: "Mine",
  kind: "email",
  description: "",
  subject: "Aging | {{date_subject}}",
  to: "",
  cc: "",
  body: "Hi\n\n{{total}} incidents",
  usedBy: ["task:weekly-aging-report"],
  ...over,
});
const must = (raw) => {
  const checked = checkInput(raw);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return checked.value;
};

describe("placeholders", () => {
  it("lists each name once, in order, with spaces inside the braces allowed", () => {
    assert.deepEqual(placeholdersIn("{{a}} and {{ b }}", "{{a}} {{c_1}}"), [
      "a",
      "b",
      "c_1",
    ]);
  });

  it("ignores things that are not placeholders", () => {
    assert.deepEqual(placeholdersIn("{{A}} {single} {{1x}} {{a-b}}"), []);
  });

  it("finds the names a target cannot fill", () => {
    assert.deepEqual(unknownPlaceholders(["{{a}} {{b}}"], new Set(["a"])), ["b"]);
  });

  it("fills names in one pass and leaves an unknown name as typed", () => {
    assert.equal(renderText("{{a}} {{b}}", { a: "{{b}}" }), "{{b}} {{b}}");
  });

  it("does not read inherited object keys as values", () => {
    assert.equal(
      renderText("{{constructor}} {{toString}}", {}),
      "{{constructor}} {{toString}}",
    );
  });

  it("tidies line breaks and blank runs", () => {
    assert.equal(tidyText("a \r\n\r\n\r\n\r\nb  \n"), "a\n\nb");
  });

  it("splits bold text for a preview", () => {
    assert.deepEqual(boldSegments("a **b** c"), [
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });

  it("renders plain text: template bold markers go, a value's stars stay", () => {
    const out = renderFields(
      { subject: "S {{x}}\nmore", to: "", cc: "", body: "**Hi** {{x}}\n\n\n\nbye" },
      { x: "*1*" },
    );
    assert.deepEqual(out, {
      subject: "S *1* more",
      to: "",
      cc: "",
      body: "Hi *1*\n\nbye",
    });
  });
});

describe("checking an edit", () => {
  it("accepts a good template and cleans it", () => {
    const value = must(
      input({ name: "  Mine  ", subject: "A\nB", body: "x\r\n\r\n\r\ny" }),
    );
    assert.equal(value.name, "Mine");
    assert.equal(value.subject, "A B");
    assert.equal(value.body, "x\n\ny");
  });

  it("asks for a name, a kind and a message", () => {
    const checked = checkInput({ name: " ", kind: "sms", body: "" });
    assert.equal(checked.ok, false);
    assert.deepEqual(Object.keys(checked.errors).sort(), ["body", "kind", "name"]);
  });

  it("keeps a subject and the addresses on one line", () => {
    const value = must(input({ to: "a@x.com\nbcc: b@x.com", cc: "c@x.com\r\nd@x.com" }));
    assert.equal(value.to, "a@x.com bcc: b@x.com");
    assert.equal(value.cc, "c@x.com d@x.com");
  });

  it("refuses a place that does not exist or takes the other kind", () => {
    assert.match(
      checkInput(input({ usedBy: ["task:nope"] })).errors.usedBy,
      /no longer exists/,
    );
    const wrong = checkInput(input({ usedBy: ["app:pmo-todo:report"] }));
    assert.match(wrong.errors.usedBy, /takes Report templates, not Email/);
  });

  it("refuses a placeholder the chosen place cannot fill, but allows any when unused", () => {
    const bad = checkInput(input({ body: "{{total}} {{oops}}" }));
    assert.match(bad.errors.body, /\{\{oops\}\} is not available/);
    assert.equal(checkInput(input({ body: "{{oops}}", usedBy: [] })).ok, true);
  });

  it("only allows what every chosen place can fill", () => {
    const both = ["task:weekly-aging-report", "task:weekly-backlog-report"];
    assert.deepEqual([...allowedPlaceholders(both)].sort(), ["people", "total"]);
    assert.equal(allowedPlaceholders([]), null);
    assert.equal(checkInput(input({ usedBy: both, body: "{{date_full}}" })).ok, false);
  });

  it("drops duplicate places", () => {
    const value = must(
      input({ usedBy: ["task:weekly-aging-report", "task:weekly-aging-report"] }),
    );
    assert.deepEqual(value.usedBy, ["task:weekly-aging-report"]);
  });

  it("keeps only a starter id that exists", () => {
    assert.equal(must(input({ starterId: "chaser" })).starterId, "chaser");
    assert.equal(must(input({ starterId: "nope" })).starterId, undefined);
  });

  it("limits the length of each field", () => {
    assert.equal(checkInput(input({ name: "n".repeat(81) })).ok, false);
    assert.equal(checkInput(input({ subject: "s".repeat(201) })).ok, false);
    assert.equal(checkInput(input({ body: "b".repeat(20_001) })).ok, false);
  });
});

describe("the library", () => {
  it("starts with every starter, each used where it was used before", () => {
    const library = starterLibrary(NOW);
    assert.equal(library.templates.length, STARTERS.length);
    for (const target of TARGETS) {
      assert.ok(templateFor(library, target.key), `${target.key} has a starter`);
    }
  });

  it("every starter is valid and only uses placeholders its targets can fill", () => {
    for (const starter of STARTERS) {
      const checked = checkInput(starter);
      assert.equal(
        checked.ok,
        true,
        `${starter.starterId}: ${JSON.stringify(checked.errors)}`,
      );
    }
  });

  it("creates, and a place has one template: claiming it takes it from the other", () => {
    let library = emptyLibrary();
    const a = createTemplate(
      library,
      must(input({ name: "A" })),
      NOW,
      "tpl_aaaaaaaaaaaa",
    );
    library = a.library;
    const b = createTemplate(
      library,
      must(input({ name: "B" })),
      LATER,
      "tpl_bbbbbbbbbbbb",
    );
    assert.deepEqual(b.displaced, [
      {
        templateId: "tpl_aaaaaaaaaaaa",
        templateName: "A",
        targetKey: "task:weekly-aging-report",
      },
    ]);
    assert.equal(templateFor(b.library, "task:weekly-aging-report").name, "B");
    const first = b.library.templates.find((t) => t.id === "tpl_aaaaaaaaaaaa");
    assert.deepEqual(first.usedBy, []);
    assert.equal(first.updatedAt, LATER);
  });

  it("updates in place and keeps the creation time", () => {
    const made = createTemplate(emptyLibrary(), must(input()), NOW, "tpl_aaaaaaaaaaaa");
    const saved = updateTemplate(
      made.library,
      "tpl_aaaaaaaaaaaa",
      must(input({ name: "New", usedBy: [] })),
      LATER,
    );
    assert.equal(saved.template.name, "New");
    assert.equal(saved.template.createdAt, NOW);
    assert.equal(saved.template.updatedAt, LATER);
    assert.equal(templateFor(saved.library, "task:weekly-aging-report"), null);
    assert.deepEqual(saved.displaced, []);
  });

  it("does not report a template as displaced from itself", () => {
    const made = createTemplate(emptyLibrary(), must(input()), NOW, "tpl_aaaaaaaaaaaa");
    const saved = updateTemplate(
      made.library,
      "tpl_aaaaaaaaaaaa",
      must(input({ name: "Again" })),
      LATER,
    );
    assert.deepEqual(saved.displaced, []);
  });

  it("refuses to update or delete what is gone", () => {
    assert.match(
      updateTemplate(emptyLibrary(), "tpl_aaaaaaaaaaaa", must(input()), NOW).error,
      /no longer exists/,
    );
    assert.match(
      deleteTemplate(emptyLibrary(), "tpl_aaaaaaaaaaaa").error,
      /no longer exists/,
    );
  });

  it("deleting frees its places", () => {
    const made = createTemplate(emptyLibrary(), must(input()), NOW, "tpl_aaaaaaaaaaaa");
    const gone = deleteTemplate(made.library, "tpl_aaaaaaaaaaaa");
    assert.equal(gone.library.templates.length, 0);
    assert.equal(templateFor(gone.library, "task:weekly-aging-report"), null);
  });

  it("caps the number of templates", () => {
    let library = emptyLibrary();
    for (let n = 0; n < 100; n++) {
      library = createTemplate(
        library,
        must(input({ name: `T${n}`, usedBy: [] })),
        NOW,
      ).library;
    }
    assert.match(
      createTemplate(library, must(input({ usedBy: [] })), NOW).error,
      /at most 100/,
    );
  });
});

describe("reading a saved library", () => {
  const saved = (over = {}) => ({
    id: "tpl_0123456789ab",
    name: "Kept",
    kind: "email",
    subject: "s",
    to: "",
    cc: "",
    body: "{{gone}}",
    usedBy: ["task:weekly-aging-report", "task:removed", "app:pmo-todo:report"],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  it("is not a library when there is no list", () => {
    assert.equal(parseLibrary(null), null);
    assert.equal(parseLibrary({ templates: "x" }), null);
  });

  it("keeps a template whose placeholder a target no longer offers", () => {
    const library = parseLibrary({ templates: [saved()] });
    assert.equal(library.templates[0].body, "{{gone}}");
  });

  it("drops places that are gone or take the other kind, and entries with no id or name", () => {
    const library = parseLibrary({
      templates: [saved(), saved({ id: "bad" }), saved({ name: " " }), null, 5],
    });
    assert.equal(library.templates.length, 1);
    assert.deepEqual(library.templates[0].usedBy, ["task:weekly-aging-report"]);
  });
});

describe("the target catalog", () => {
  it("has unique keys and a sample for every placeholder", () => {
    assert.equal(new Set(TARGETS.map((t) => t.key)).size, TARGETS.length);
    for (const target of TARGETS) {
      for (const p of target.placeholders) assert.ok(p.sample !== undefined && p.name);
      assert.equal(targetByKey(target.key), target);
    }
  });

  it("gives sample values for the preview", () => {
    assert.equal(sampleValues(["task:weekly-aging-report"]).total, "42");
  });
});
