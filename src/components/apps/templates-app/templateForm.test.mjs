import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blankDraft,
  copyOf,
  draftOf,
  holderOf,
  insertAt,
  isDirty,
  offeredPlaceholders,
  placeGroups,
  previewOf,
  problems,
  toInput,
  withKind,
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
    assert.deepEqual(names({ kind: "report", usedBy: [] }), [
      "report",
      "title",
      "period",
      "my_name",
    ]);
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
});
