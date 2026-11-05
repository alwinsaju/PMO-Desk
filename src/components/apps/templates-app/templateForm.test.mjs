import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blankDraft,
  copyOf,
  draftOf,
  filterPlaceholders,
  holderOf,
  importSummary,
  insertAt,
  isDirty,
  offeredPlaceholders,
  placeGroups,
  previewOf,
  problems,
  restoreInput,
  restoreSummary,
  saveBlockedMessage,
  tagsSavedMessage,
  toInput,
  toggleWrap,
  undoNotice,
  versionInput,
  withKind,
  wordingOf,
  withPlace,
} from "./templateForm.ts";

const saved = (over = {}) => ({
  id: "tpl_0123456789ab",
  name: "Aging",
  kind: "email",
  description: "d",
  subject: "S {{total}}",
  to: "",
  cc: "",
  body: "Hi {{total}}",
  usedBy: ["task:weekly-aging-report"],
  createdAt: "x",
  updatedAt: "x",
  ...over,
});

describe("the draft", () => {
  it("a deleted template can be put back with everything a person set", () => {
    const tpl = saved({
      tags: ["weekly"],
      variants: [{ id: "v1", label: "Client", subject: "S", body: "B" }],
      starterId: "aging",
    });
    const back = restoreInput(tpl);
    assert.deepEqual(back.tags, ["weekly"]);
    assert.deepEqual(back.variants, tpl.variants);
    assert.notEqual(back.usedBy, tpl.usedBy);
    assert.deepEqual(back.usedBy, tpl.usedBy);
    for (const key of ["id", "createdAt", "updatedAt", "history"]) {
      assert.equal(key in back, false);
    }
    assert.equal(back.name, "Aging");
    assert.equal(back.starterId, "aging");
  });

  it("a new draft is clean until something is typed or chosen", () => {
    const blank = blankDraft();
    assert.equal(isDirty(blank, null), false);
    assert.equal(isDirty({ ...blank, name: "x" }, null), true);
    assert.equal(isDirty(withPlace(blank, "task:weekly-aging-report", true), null), true);
  });

  it("a saved draft is changed by any field, and the order of places does not matter", () => {
    const tpl = saved({
      usedBy: ["task:weekly-aging-report", "task:weekly-backlog-report"],
    });
    const draft = draftOf(tpl);
    assert.equal(isDirty(draft, tpl), false);
    assert.equal(isDirty({ ...draft, usedBy: [...draft.usedBy].reverse() }, tpl), false);
    assert.equal(isDirty({ ...draft, body: "x" }, tpl), true);
    assert.equal(
      isDirty(withPlace(draft, "task:weekly-backlog-report", false), tpl),
      true,
    );
  });

  it("a copy is a new, unused template", () => {
    const copy = copyOf(saved({ starterId: "chaser" }));
    assert.equal(copy.id, null);
    assert.equal(copy.name, "Aging (copy)");
    assert.deepEqual(copy.usedBy, []);
    assert.equal(copy.starterId, undefined);
  });

  it("turns into the input the API takes, without the id", () => {
    assert.equal("id" in toInput(draftOf(saved())), false);
  });

  it("changing the kind drops places that do not take it", () => {
    const draft = withPlace(
      withPlace(blankDraft(), "task:weekly-aging-report", true),
      "task:weekly-backlog-report",
      true,
    );
    assert.deepEqual(withKind(draft, "report").usedBy, []);
    assert.deepEqual(withKind(draft, "email").usedBy, draft.usedBy);
  });

  it("adds and removes a place once", () => {
    let draft = withPlace(blankDraft(), "task:weekly-aging-report", true);
    draft = withPlace(draft, "task:weekly-aging-report", true);
    assert.deepEqual(draft.usedBy, ["task:weekly-aging-report"]);
    assert.deepEqual(withPlace(draft, "task:weekly-aging-report", false).usedBy, []);
  });
});

describe("places", () => {
  it("lists tasks then apps, only those of the kind", () => {
    const email = placeGroups("email");
    assert.deepEqual(
      email.map((g) => g.heading),
      ["Tasks", "Apps"],
    );
    assert.ok(email.every((g) => g.targets.every((t) => t.kind === "email")));
    assert.deepEqual(
      placeGroups("report").map((g) => g.heading),
      ["Apps"],
    );
  });

  it("says which other template holds a place", () => {
    const others = [
      saved(),
      saved({ id: "tpl_aaaaaaaaaaaa", name: "Other", usedBy: [] }),
    ];
    assert.equal(holderOf(others, "task:weekly-aging-report", null).name, "Aging");
    assert.equal(
      holderOf(others, "task:weekly-aging-report", "tpl_0123456789ab"),
      undefined,
    );
    assert.equal(holderOf(others, "task:weekly-backlog-report", null), undefined);
  });
});

describe("placeholders to offer", () => {
  const names = (draft) => offeredPlaceholders(draft).map((p) => p.name);

  it("with no place chosen, everything any place of the kind offers", () => {
    const all = names({ kind: "email", usedBy: [] });
    for (const name of [
      "date_subject",
      "date_full",
      "total",
      "greeting",
      "waited",
      "my_name",
    ]) {
      assert.ok(all.includes(name), name);
    }
    // Every report place adds its own (the PMO To-Do report first, then the Toolkit status report).
    const reports = names({ kind: "report", usedBy: [] });
    assert.deepEqual(reports.slice(0, 4), ["report", "title", "period", "my_name"]);
    for (const name of ["date", "overall", "projects"]) {
      assert.ok(reports.includes(name), name);
    }
  });

  it("with places chosen, only what all of them can fill", () => {
    assert.deepEqual(
      names({
        kind: "email",
        usedBy: ["task:weekly-aging-report", "task:weekly-backlog-report"],
      }).sort(),
      ["people", "total"],
    );
  });
});

describe("inserting a placeholder", () => {
  it("replaces the selection and puts the caret after it", () => {
    assert.deepEqual(insertAt("Hello world", 6, 11, "{{x}}"), {
      value: "Hello {{x}}",
      caret: 11,
    });
  });

  it("clamps a selection that is out of range", () => {
    assert.deepEqual(insertAt("ab", 5, 9, "!"), { value: "ab!", caret: 3 });
    assert.deepEqual(insertAt("ab", 2, 1, "!"), { value: "ab!", caret: 3 });
  });
});

describe("bold toggle", () => {
  it("wraps the selection and keeps it selected", () => {
    assert.deepEqual(toggleWrap("Hello world", 6, 11), {
      value: "Hello **world**",
      start: 8,
      end: 13,
    });
  });
  it("puts the marks around the caret when nothing is selected", () => {
    assert.deepEqual(toggleWrap("ab", 1, 1), { value: "a****b", start: 3, end: 3 });
  });
  it("takes the marks off, whether selected or just outside the selection", () => {
    assert.deepEqual(toggleWrap("a **b** c", 2, 7), { value: "a b c", start: 2, end: 3 });
    assert.deepEqual(toggleWrap("a **b** c", 4, 5), { value: "a b c", start: 2, end: 3 });
  });
  it("clamps an out-of-range selection", () => {
    assert.equal(toggleWrap("ab", 9, 12).value, "ab****");
  });
});

describe("placeholder search", () => {
  const tokens = [
    { name: "total", description: "How many incidents" },
    { name: "date_subject", description: "Today's date for a subject line" },
  ];
  it("matches the name or description, ignoring braces and case", () => {
    assert.deepEqual(filterPlaceholders(tokens, "{{TOT"), [tokens[0]]);
    assert.deepEqual(filterPlaceholders(tokens, "subject line"), [tokens[1]]);
    assert.deepEqual(filterPlaceholders(tokens, "nothing"), []);
  });
  it("lists all for an empty search", () => {
    assert.deepEqual(filterPlaceholders(tokens, "  "), tokens);
  });
});

describe("restoring a version", () => {
  it("brings back its wording and keeps places and tags", () => {
    const template = saved({ tags: ["t"], usedBy: ["task:weekly-aging-report"] });
    const input = versionInput(template, {
      at: "2026-01-01T00:00:00Z",
      name: "Old",
      description: "od",
      subject: "OS",
      to: "a@b.co",
      cc: "",
      body: "Old body",
    });
    assert.equal(input.name, "Old");
    assert.equal(input.body, "Old body");
    assert.equal(input.to, "a@b.co");
    assert.deepEqual(input.tags, ["t"]);
    assert.deepEqual(input.usedBy, ["task:weekly-aging-report"]);
    assert.equal(input.kind, "email");
  });
});

describe("preview and problems", () => {
  it("fills the chosen place's sample values", () => {
    const preview = previewOf({
      ...draftOf(saved()),
      usedBy: ["task:weekly-aging-report"],
    });
    assert.equal(preview.subject, "S 42");
    assert.equal(preview.body, "Hi 42");
  });

  it("with no place chosen, still previews with samples of the kind", () => {
    assert.equal(previewOf({ ...blankDraft(), body: "{{total}}" }).body, "42");
  });

  it("reports what is wrong, per field", () => {
    assert.deepEqual(Object.keys(problems(blankDraft())).sort(), ["body", "name"]);
    assert.deepEqual(problems({ ...draftOf(saved()) }), {});
    assert.match(
      problems({ ...draftOf(saved()), body: "{{nope}}" }).body,
      /not available/,
    );
  });

  it("refuses a To or Cc entry that is not an email address, but only for emails", () => {
    const base = draftOf(saved());
    assert.deepEqual(problems({ ...base, to: "a@x.com; Last, First <b@x.com>" }), {});
    assert.match(problems({ ...base, to: "Support team" }).to, /not an email address/);
    assert.match(problems({ ...base, cc: "a@x.com; oops" }).cc, /“oops”/);
    assert.equal(problems({ ...base, kind: "report", to: "Support team" }).to, undefined);
  });
});

describe("copying the wording", () => {
  it("keeps the placeholders and bold markers, not the example values", () => {
    const draft = {
      ...draftOf(saved()),
      subject: "Aging | {{date_subject}}",
      body: "Hi,\n\n**{{total}}** open.\n",
    };
    const text = wordingOf(draft);
    assert.equal(text, "Subject: Aging | {{date_subject}}\n\nHi,\n\n**{{total}}** open.");
    assert.ok(text.includes("{{total}}"));
    assert.ok(!text.includes("42"), "the example value is not substituted");
    assert.notEqual(text, previewOf(draft).body);
  });

  it("labels a report's first line as the title line", () => {
    assert.equal(
      wordingOf({ kind: "report", subject: "{{title}}", body: "Body" }),
      "Title line: {{title}}\n\nBody",
    );
  });

  it("copes with a missing subject or body", () => {
    assert.equal(wordingOf({ kind: "email", subject: "  ", body: " Hi " }), "Hi");
    assert.equal(wordingOf({ kind: "email", subject: "S", body: "" }), "Subject: S");
    assert.equal(wordingOf({ kind: "email", subject: "", body: "" }), "");
  });
});

describe("explaining a refused Save", () => {
  it("puts the first problem in one line, in the order of the form", () => {
    assert.equal(saveBlockedMessage({}), null);
    assert.equal(
      saveBlockedMessage({
        body: "The message is empty.",
        name: "Give the template a name.",
      }),
      "Not saved yet: Give the template a name.",
    );
    assert.equal(
      saveBlockedMessage({ variants: "Check the other wording." }),
      "Not saved yet: Check the other wording.",
    );
  });
  it("reads the problems of a real form", () => {
    const message = saveBlockedMessage(
      problems({
        ...blankDraft(),
        body: "Hi {{zzz}}",
        usedBy: ["task:weekly-aging-report"],
        name: "N",
      }),
    );
    assert.match(message, /\{\{zzz\}\}/);
  });
});

describe("tags saved message", () => {
  it("confirms, and explains what was cut", () => {
    assert.equal(tagsSavedMessage(["a", "b"], ["a", "b"]), "Tags saved.");
    assert.equal(tagsSavedMessage([], []), "Tags cleared.");
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`);
    assert.match(tagsSavedMessage(many, many.slice(0, 8)), /8 kept.*at most 8 tags/);
    assert.match(tagsSavedMessage(["x".repeat(50)], ["x".repeat(30)]), /shortened to 30/);
    assert.equal(tagsSavedMessage(["A", "a"], ["A"]), "Tags saved.");
  });
});

describe("undo notice", () => {
  it("says which places stayed with the template that took them", () => {
    assert.equal(undoNotice("Mine", []), "Brought back “Mine”.");
    assert.match(undoNotice("Mine", ["a"]), /One place now uses another template/);
    assert.match(undoNotice("Mine", ["a", "b"]), /2 places now use another template/);
  });
});

describe("import and restore notes", () => {
  it("counts imports and explains failures instead of hiding them", () => {
    assert.equal(
      importSummary(2, [], []),
      "Imported 2 templates. None is used anywhere until you choose.",
    );
    assert.equal(
      importSummary(
        1,
        [
          "The library holds at most 100 templates.",
          "The library holds at most 100 templates.",
        ],
        ["Dup"],
      ),
      "Imported 1 template; skipped Dup. 2 could not be added. The library holds at most 100 templates. None is used anywhere until you choose.",
    );
  });
  it("says what restoring built-in templates did", () => {
    assert.match(
      restoreSummary({ added: 15, rebuilt: true, backup: "library.json.bak" }),
      /fresh library.*library\.json\.bak/,
    );
    assert.match(
      restoreSummary({ added: 0, rebuilt: false, backup: null }),
      /already there/,
    );
    assert.match(
      restoreSummary({ added: 1, rebuilt: false, backup: null }),
      /Added back 1 built-in template\./,
    );
  });
});
