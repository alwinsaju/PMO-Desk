// Run with `pnpm test`. Conditional blocks and snippets. The vectors are the same as
// tasks/shared/template_lib/tests/test_conditions.py: the two renderers must agree.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inlineSnippets,
  placeholdersIn,
  renderFields,
  renderText,
  resolveConditions,
  snippetKey,
  snippetsFrom,
  unknownPlaceholders,
} from "./render.ts";

// [template, values, snippets, expected]
const VECTORS = [
  ["{{#if total}}Total: {{total}}{{/if}}", { total: "5" }, {}, "Total: 5"],
  ["{{#if total}}Total: {{total}}{{/if}}", { total: "0" }, {}, ""],
  ["A{{#if x}}B{{else}}C{{/if}}D", { x: "1" }, {}, "ABD"],
  ["A{{#if x}}B{{else}}C{{/if}}D", { x: "" }, {}, "ACD"],
  ["A{{#if x}}B{{else}}C{{/if}}D", {}, {}, "ACD"],
  ["{{#if n > 3}}many{{else}}few{{/if}}", { n: "5" }, {}, "many"],
  ["{{#if n > 3}}many{{else}}few{{/if}}", { n: "2" }, {}, "few"],
  ["{{#if n > 3}}many{{else}}few{{/if}}", { n: "abc" }, {}, "few"],
  ["{{#if n >= 3}}y{{/if}}", { n: "3" }, {}, "y"],
  ["{{#if n != 3}}y{{else}}n{{/if}}", { n: "3" }, {}, "n"],
  ["{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", { a: "1", b: "1" }, {}, "123"],
  ["{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", { a: "1", b: "0" }, {}, "13"],
  ["{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", { a: "0", b: "1" }, {}, ""],
  ["{{#if s = open}}yes{{else}}no{{/if}}", { s: "Open" }, {}, "yes"],
  ["{{ #if a }}x{{ /if }}", { a: "1" }, {}, "x"],
  ["{{#if a}}x", { a: "1" }, {}, "{{#if a}}x"],
  ["Hi{{> sig}}", {}, { sig: "\n--\nPat" }, "Hi\n--\nPat"],
  ["Hi {{> nope}}", {}, { sig: "x" }, "Hi {{> nope}}"],
  ["{{> a}}", {}, { a: "A+{{> b}}", b: "B" }, "A+B"],
  [
    "{{> sig}} {{name}}",
    { name: "Pat" },
    { sig: "{{#if name}}Hello {{/if}}" },
    "Hello  Pat",
  ],
  ["Keep {{unknown}} as typed", {}, {}, "Keep {{unknown}} as typed"],
];

describe("conditions and snippets (shared vectors)", () => {
  for (const [source, values, snippets, expected] of VECTORS) {
    it(`${JSON.stringify(source)} with ${JSON.stringify(values)}`, () => {
      assert.equal(renderText(source, values, snippets), expected);
    });
  }
});

describe("helpers", () => {
  it("names snippets like the Python twin", () => {
    assert.equal(snippetKey("Email signature"), "email_signature");
    assert.equal(snippetKey("  9 lives "), "s_9_lives");
    assert.equal(snippetKey("***"), "");
  });
  it("collects snippets from a list of templates", () => {
    const s = snippetsFrom([
      { kind: "email", name: "Mail", body: "x" },
      { kind: "snippet", name: "Signature", body: "Pat" },
      { kind: "snippet", name: "signature", body: "dup" },
    ]);
    assert.deepEqual(s, { signature: "Pat" });
    assert.equal(inlineSnippets("{{> signature}}", s), "Pat");
  });
  it("sees the names used in conditions", () => {
    assert.deepEqual(placeholdersIn("{{#if total > 3}}{{name}}{{/if}}"), [
      "name",
      "total",
    ]);
    assert.deepEqual(unknownPlaceholders(["{{#if bogus}}x{{/if}}"], new Set(["total"])), [
      "bogus",
    ]);
  });
  it("resolves conditions and tidies the result in a rendered template", () => {
    const out = renderFields(
      {
        subject: "Hi {{#if x}}there{{/if}}",
        to: "",
        cc: "",
        body: "A\n\n{{#if x}}B{{/if}}\n\nC",
      },
      { x: "" },
    );
    assert.equal(out.subject, "Hi");
    assert.equal(out.body, "A\n\nC");
    assert.equal(resolveConditions("{{#if a}}x{{/if}}", { a: "1" }), "x");
  });
});
