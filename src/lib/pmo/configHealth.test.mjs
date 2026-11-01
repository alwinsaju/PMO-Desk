// Run with `pnpm test`. Field errors for the routes' 400 answers, and how
// already-saved malformed config is flagged and kept out of one-click edits.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowDomainPlan, malformedConfigEntries } from "./configHealth.ts";
import { fieldErrors, replyStatus, summarizeFieldErrors } from "./fieldErrors.ts";
import { PmoConfigPatchSchema } from "./types.ts";

describe("fieldErrors", () => {
  const body = {
    allowedSenderDomains: ["ok.com", "nope"],
    me: { names: ["Pat"], emails: ["x".repeat(300)] },
    retentionDays: "abc",
  };
  const errors = () => {
    const parsed = PmoConfigPatchSchema.safeParse(body);
    assert.equal(parsed.success, false);
    return fieldErrors(parsed.error, body);
  };

  it("names the field, the position and the submitted entry for each problem", () => {
    const list = errors();
    assert.deepEqual(
      list.find((e) => e.field === "allowedSenderDomains"),
      {
        field: "allowedSenderDomains",
        index: 1,
        value: "nope",
        reason: "Not a domain (example: company.com)",
      },
    );
    const email = list.find((e) => e.field === "me.emails");
    assert.equal(email.index, 0);
    assert.ok(email.value.length < 100, "a long value is shortened");
    const retention = list.find((e) => e.field === "retentionDays");
    assert.equal(retention.index, undefined);
    assert.equal(retention.value, "abc");
  });

  it("summarises the first problem in one line", () => {
    assert.match(
      summarizeFieldErrors(errors()),
      /^allowedSenderDomains: "nope": Not a domain/,
    );
    assert.match(summarizeFieldErrors(errors()), /\(and \d+ more\)$/);
    assert.equal(summarizeFieldErrors([]), "");
  });

  it("copes with a body that is not an object", () => {
    const parsed = PmoConfigPatchSchema.safeParse("nope");
    assert.equal(parsed.success, false);
    const list = fieldErrors(parsed.error, "nope");
    assert.equal(list.length > 0, true);
    assert.equal(list[0].value, "nope");
  });
});

describe("replyStatus", () => {
  it("is 400 only for a refusal that lists entries", () => {
    assert.equal(replyStatus({ ok: false, reason: "x", errors: [] }), 400);
    assert.equal(replyStatus({ ok: false, reason: "x" }), 200);
    assert.equal(replyStatus({ ok: true, errors: [] }), 200);
    assert.equal(replyStatus({ ok: true }), 200);
  });
});

describe("malformedConfigEntries", () => {
  it("flags saved values that would not be accepted today, with the reason", () => {
    const found = malformedConfigEntries({
      allowedSenderDomains: ["deloitte.comdeloitte.com", "deloitte.com"],
      blockedDomains: ["*.rival.com"],
      me: { emails: ["alex", "a.morganalex.morgan@deloitte.com", "pat@deloitte.com"] },
    });
    assert.deepEqual(
      found.map((f) => [f.field, f.value]),
      [
        ["allowedSenderDomains", "deloitte.comdeloitte.com"],
        ["blockedDomains", "*.rival.com"],
        ["emails", "alex"],
      ],
    );
    assert.match(found[0].reason, /typed twice/);
  });

  it("flags nothing in a clean or empty config, and never throws on odd shapes", () => {
    assert.deepEqual(malformedConfigEntries({}), []);
    assert.deepEqual(
      malformedConfigEntries({
        allowedSenderDomains: ["Deloitte.com", "  "],
        blockedDomains: [],
        me: { emails: ["Pat@Deloitte.com"] },
      }),
      [],
    );
    const odd = malformedConfigEntries({
      allowedSenderDomains: [42, null, "ok.com"],
      blockedDomains: "not a list",
      me: null,
    });
    assert.equal(odd.length, 2);
    assert.equal(odd[0].reason, "Not text");
  });
});

describe("allowDomainPlan", () => {
  it("adds a valid domain to the normalised saved list", () => {
    const plan = allowDomainPlan(
      { allowedSenderDomains: ["Contoso.com"] },
      "Deloitte.com",
    );
    assert.deepEqual(plan, {
      ok: true,
      patch: { allowedSenderDomains: ["contoso.com", "deloitte.com"] },
      dropped: [],
    });
  });

  it("does not repeat a domain that is already there", () => {
    const plan = allowDomainPlan(
      { allowedSenderDomains: ["deloitte.com"] },
      "DELOITTE.COM",
    );
    assert.deepEqual(plan.patch.allowedSenderDomains, ["deloitte.com"]);
  });

  it("leaves malformed saved entries out and says which, so the save is accepted", () => {
    const plan = allowDomainPlan(
      { allowedSenderDomains: ["deloitte.comdeloitte.com", "contoso.com"] },
      "deloitte.com",
    );
    assert.deepEqual(plan.patch.allowedSenderDomains, ["contoso.com", "deloitte.com"]);
    assert.deepEqual(plan.dropped, ["deloitte.comdeloitte.com"]);
    assert.equal(PmoConfigPatchSchema.safeParse(plan.patch).success, true);
  });

  it("refuses a domain that is not valid, naming it", () => {
    for (const bad of ["", "nope", "deloitte.comdeloitte.com", "a@b.com"]) {
      const plan = allowDomainPlan({ allowedSenderDomains: [] }, bad);
      assert.equal(plan.ok, false, bad);
      assert.match(plan.reason, /Not a domain|typed twice|email address/);
    }
  });
});
