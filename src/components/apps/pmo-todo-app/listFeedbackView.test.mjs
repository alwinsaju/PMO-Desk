// Run with `pnpm test`. The wording of the live feedback under the email and
// domain boxes (pure; no React).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDomainList } from "../../../lib/pmo/listValidation.ts";
import { DOMAIN_NOUN, EMAIL_NOUN, listFeedback } from "./listFeedbackView.ts";

describe("listFeedback", () => {
  it("says what will be saved, singular and plural", () => {
    assert.equal(
      listFeedback(parseDomainList("a.com"), DOMAIN_NOUN).accepted,
      "1 domain will be saved: a.com",
    );
    assert.equal(
      listFeedback(parseDomainList("a.com, B.com"), DOMAIN_NOUN).accepted,
      "2 domains will be saved: a.com, b.com",
    );
    assert.match(
      listFeedback({ valid: ["a@x.com"], invalid: [] }, EMAIL_NOUN).accepted,
      /^1 address will be saved/,
    );
  });

  it("lists the refused entries with their reasons next to the accepted ones", () => {
    const view = listFeedback(parseDomainList("a.com\nnope\nb.comb.com"), DOMAIN_NOUN);
    assert.equal(view.accepted, "1 domain will be saved: a.com");
    assert.deepEqual(
      view.rejected.map((r) => r.value),
      ["nope", "b.comb.com"],
    );
    assert.equal(view.hiddenRejected, 0);
  });

  it("has nothing to say for nothing valid, and shortens long results", () => {
    assert.equal(listFeedback(parseDomainList(""), DOMAIN_NOUN).accepted, null);
    const many = parseDomainList(
      Array.from({ length: 10 }, (_, i) => `d${i}.com`).join(" ") +
        " " +
        Array.from({ length: 9 }, (_, i) => `bad${i}`).join(" "),
    );
    const view = listFeedback(many, DOMAIN_NOUN);
    assert.match(view.accepted, /^10 domains will be saved: .* and 4 more$/);
    assert.equal(view.rejected.length, 6);
    assert.equal(view.hiddenRejected, 3);
  });
});
