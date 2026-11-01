// Run with `pnpm test`. The shared email / domain list checks behind PMO setup,
// settings and the Filtered tab.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOUBLED_DOMAIN,
  JOINED_EMAILS,
  MAX_LIST_ENTRIES,
  MAX_LIST_INPUT_CHARS,
  NOT_DOMAIN,
  NOT_EMAIL,
  checkDomain,
  checkEmail,
  parseDomainList,
  parseEmailList,
} from "./listValidation.ts";

const reasons = (parsed) => parsed.invalid.map((issue) => issue.reason);

describe("checkDomain", () => {
  it("normalises case, a leading @ and trailing dots", () => {
    for (const typed of [
      "Company.com",
      "@company.com",
      "company.com.",
      " @COMPANY.COM.. ",
    ]) {
      assert.deepEqual(checkDomain(typed), { ok: true, value: "company.com" }, typed);
    }
  });
  it("accepts subdomains and hyphens", () => {
    assert.equal(checkDomain("us.my-company.co.uk").ok, true);
  });
  it("rejects things that are not a registrable-looking domain", () => {
    for (const typed of [
      "",
      "@",
      "company",
      "localhost",
      ".com",
      "company..com",
      "-company.com",
      "company-.com",
      "company.c",
      "company.123",
      "https://company.com",
      "company.com/path",
      "com pany.com",
    ]) {
      assert.equal(checkDomain(typed).ok, false, typed);
    }
    assert.equal(checkDomain("company").reason, NOT_DOMAIN);
  });
  it("explains an email, a wildcard, accents and a joined pair", () => {
    assert.match(checkDomain("pat@company.com").reason, /email address/);
    assert.match(checkDomain("*.company.com").reason, /wildcard/i);
    assert.match(checkDomain("compañy.com").reason, /plain letters/);
    assert.match(checkDomain("münchen.de").reason, /plain letters/);
    assert.match(checkDomain("a.com b.com").reason, /two domains/);
  });
  it("catches a domain typed twice (a pre-filled box that was appended to)", () => {
    assert.deepEqual(checkDomain("deloitte.comdeloitte.com"), {
      ok: false,
      reason: DOUBLED_DOMAIN,
    });
    assert.equal(checkDomain("us.deloitte.comus.deloitte.com").ok, false);
    assert.equal(checkDomain("deloitte.co.ukdeloitte.co.uk").ok, false);
  });
  it("does not mistake real domains for a doubled one", () => {
    for (const real of [
      "a.compass.com",
      "mail.mailer.com",
      "deloitte.com",
      "compass.com",
      "us.deloitte.com",
      "ab.cd.ef.com",
    ]) {
      assert.equal(checkDomain(real).ok, true, real);
    }
  });
  it("rejects a name over the DNS length limit", () => {
    assert.equal(checkDomain(`${"a".repeat(64)}.com`).ok, false);
    assert.equal(checkDomain(`${"abcdefghi.".repeat(26)}com`).ok, false);
  });
});

describe("checkEmail", () => {
  it("normalises case, a mailto: prefix, a display name and a trailing dot", () => {
    for (const typed of [
      "Pat@Company.COM",
      "mailto:pat@company.com",
      "Pat Example <pat@company.com>",
      "<pat@company.com>",
      "pat@company.com.",
    ]) {
      assert.deepEqual(checkEmail(typed), { ok: true, value: "pat@company.com" }, typed);
    }
  });
  it("rejects a name without a domain, as in the QA run", () => {
    assert.deepEqual(checkEmail("alex"), { ok: false, reason: NOT_EMAIL });
    assert.deepEqual(checkEmail("A.Morgan"), { ok: false, reason: NOT_EMAIL });
  });
  it("rejects malformed addresses", () => {
    for (const typed of [
      "",
      "@company.com",
      "pat@",
      "pat@company",
      "pat@@company.com",
      ".pat@company.com",
      "pat.@company.com",
      "pa..t@company.com",
      "pat@-company.com",
      "pat(at)company.com",
      'pa"t@company.com',
      `${"a".repeat(65)}@company.com`,
    ]) {
      assert.equal(checkEmail(typed).ok, false, typed);
    }
  });
  it("rejects accents and other unicode in an address", () => {
    assert.equal(checkEmail("pät@company.com").ok, false);
    assert.equal(checkEmail("pat@compañy.com").ok, false);
    assert.equal(checkEmail("pat\u200b@company.com").ok, false);
  });
  it("detects two addresses joined together or a doubled domain", () => {
    assert.equal(checkEmail("a@x.comb@y.com").reason, JOINED_EMAILS);
    assert.equal(checkEmail("a@x.com b@y.com").reason, JOINED_EMAILS);
    assert.equal(checkEmail("a@x.com,b@y.com").reason, JOINED_EMAILS);
    assert.equal(checkEmail("pat@deloitte.comdeloitte.com").reason, DOUBLED_DOMAIN);
  });
});

describe("parseDomainList", () => {
  it("splits on newlines, commas, semicolons and spaces, and de-duplicates", () => {
    const parsed = parseDomainList("a.com, B.com;c.com\nd.com  A.COM\r\n@b.com");
    assert.deepEqual(parsed.valid, ["a.com", "b.com", "c.com", "d.com"]);
    assert.deepEqual(parsed.invalid, []);
  });
  it("returns the valid and the invalid entries side by side, with reasons", () => {
    const parsed = parseDomainList(
      "deloitte.com\nnope\ndeloitte.comdeloitte.com\nx@y.com",
    );
    assert.deepEqual(parsed.valid, ["deloitte.com"]);
    assert.deepEqual(
      parsed.invalid.map((issue) => issue.value),
      ["nope", "deloitte.comdeloitte.com", "x@y.com"],
    );
    assert.equal(parsed.invalid[0].reason, NOT_DOMAIN);
    assert.equal(parsed.invalid[1].reason, DOUBLED_DOMAIN);
  });
  it("is empty for blank input", () => {
    assert.deepEqual(parseDomainList(" \n ,; "), { valid: [], invalid: [] });
    assert.deepEqual(parseDomainList([]), { valid: [], invalid: [] });
  });
  it("reports a repeated bad entry once", () => {
    assert.equal(parseDomainList("nope nope NOPE").invalid.length, 2);
    assert.equal(parseDomainList("nope\nnope").invalid.length, 1);
  });
  it("checks array elements one by one, never splitting them", () => {
    const parsed = parseDomainList(["A.com", "b.com, c.com", "", "  "]);
    assert.deepEqual(parsed.valid, ["a.com"]);
    assert.equal(parsed.invalid.length, 1);
    assert.match(parsed.invalid[0].reason, /two domains/);
  });
  it("caps the number of entries", () => {
    const text = Array.from({ length: 250 }, (_, i) => `d${i}.com`).join("\n");
    const parsed = parseDomainList(text);
    assert.equal(parsed.valid.length, MAX_LIST_ENTRIES);
    assert.equal(parsed.invalid.length, 1);
    assert.match(parsed.invalid[0].reason, /Too many entries/);
    assert.equal(parsed.invalid[0].value, "50 more");
    assert.equal(parseDomainList(text, { max: 10 }).valid.length, 10);
  });
  it("cuts off very long input and says so", () => {
    const text = `a.com\n${"x".repeat(MAX_LIST_INPUT_CHARS * 2)}`;
    const parsed = parseDomainList(text);
    assert.deepEqual(parsed.valid, ["a.com"]);
    assert.ok(parsed.invalid.some((issue) => /Too much text/.test(issue.reason)));
    assert.ok(parsed.invalid.every((issue) => issue.value.length < 120));
  });
  it("treats unicode as invalid, not as an error", () => {
    const parsed = parseDomainList("münchen.de ok.com 公司.中国");
    assert.deepEqual(parsed.valid, ["ok.com"]);
    assert.equal(parsed.invalid.length, 2);
  });
});

describe("parseEmailList", () => {
  it("accepts commas, newlines, semicolons and uppercase", () => {
    const parsed = parseEmailList("Pat@Company.com, sam@company.com;\nLee@Company.com");
    assert.deepEqual(parsed.valid, [
      "pat@company.com",
      "sam@company.com",
      "lee@company.com",
    ]);
  });
  it("reads Outlook-style 'Name <address>' lists", () => {
    const parsed = parseEmailList("Pat Example <pat@company.com>; Sam <sam@company.com>");
    assert.deepEqual(parsed.valid, ["pat@company.com", "sam@company.com"]);
    assert.deepEqual(parsed.invalid, []);
  });
  it("rejects the QA-02 input `Alex,A.Morgan` entry by entry", () => {
    const parsed = parseEmailList("Alex,A.Morgan");
    assert.deepEqual(parsed.valid, []);
    assert.deepEqual(
      parsed.invalid.map((issue) => issue.value),
      ["Alex", "A.Morgan"],
    );
    assert.deepEqual(reasons(parsed), [NOT_EMAIL, NOT_EMAIL]);
  });
  it("keeps the good entries and flags the joined one", () => {
    const parsed = parseEmailList("ok@company.com\nsam@company.comlee@company.com");
    assert.deepEqual(parsed.valid, ["ok@company.com"]);
    assert.deepEqual(reasons(parsed), [JOINED_EMAILS]);
  });
  it("caps the number of entries", () => {
    const text = Array.from({ length: 205 }, (_, i) => `p${i}@company.com`).join(",");
    const parsed = parseEmailList(text);
    assert.equal(parsed.valid.length, MAX_LIST_ENTRIES);
    assert.equal(parsed.invalid[0].value, "5 more");
  });
  it("checks array elements as whole addresses", () => {
    const parsed = parseEmailList(["a@x.com", "A@X.com", "b@x.com c@x.com"]);
    assert.deepEqual(parsed.valid, ["a@x.com"]);
    assert.deepEqual(reasons(parsed), [JOINED_EMAILS]);
  });
});
