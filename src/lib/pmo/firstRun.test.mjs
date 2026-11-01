// Run with `pnpm test`. The PMO first-run wizard's pure parts: list parsing,
// the form -> config mapping and its validation, the Windows user-name
// suggestion and the "existing install is already set up" migration rule.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIRST_RUN_STEPS,
  domainOfEmail,
  firstRunPayload,
  inferSetupComplete,
  initialFirstRunForm,
  needsFirstRun,
  splitList,
  loginNameHint,
  nameToGoBy,
  stepProblems,
  suggestedFullName,
  suggestedDomain,
  timeZoneChoices,
  withSuggestedDomain,
} from "./firstRun.ts";
import { PmoConfigSchema } from "./types.ts";

const form = (over = {}) => ({
  fullName: "Pat Example",
  otherNames: "Pat, Example",
  email: "pat@contoso.com",
  timeZone: "Europe/London",
  allowedDomains: "contoso.com",
  blockedDomains: "",
  inboxDir: "C:\\Users\\pat\\OneDrive\\PMO-Inbox",
  ...over,
});

describe("neutral production defaults", () => {
  it("ships no identity, domains or inbox, and is not set up", () => {
    const config = PmoConfigSchema.parse({});
    assert.deepEqual(config.me, { names: [], emails: [] });
    assert.deepEqual(config.allowedSenderDomains, []);
    assert.deepEqual(config.blockedDomains, []);
    assert.equal(config.inboxDir, "");
    assert.equal(config.setupComplete, false);
    assert.equal(config.timeZone, "Asia/Kolkata");
  });
});

describe("splitList", () => {
  it("splits on commas, semicolons, newlines and spaces; trims and de-duplicates", () => {
    assert.deepEqual(splitList(" a.com, B.com;a.com\n c.com  "), [
      "a.com",
      "B.com",
      "c.com",
    ]);
    assert.deepEqual(splitList(""), []);
  });
  it("keeps spaces inside a name when asked to split on commas only", () => {
    assert.deepEqual(splitList("Pat Example, Pat", { commasOnly: true }), [
      "Pat Example",
      "Pat",
    ]);
  });
});

describe("domainOfEmail", () => {
  it("reads the domain, lower-cased, and null for a non-address", () => {
    assert.equal(domainOfEmail("Pat@Contoso.COM"), "contoso.com");
    assert.equal(domainOfEmail("nope"), null);
    assert.equal(domainOfEmail(""), null);
  });
});

describe("suggestedFullName", () => {
  it("turns a first.last Windows user name into a capitalised suggestion", () => {
    assert.equal(suggestedFullName({ USERNAME: "pat.example" }), "Pat Example");
    assert.equal(suggestedFullName({ USERNAME: "pat_example" }), "Pat Example");
    assert.equal(suggestedFullName({ USER: "mary-jane.o" }), "Mary Jane O");
    assert.equal(suggestedFullName({ USERNAME: "zoë.müller" }), "Zoë Müller");
  });
  it("does not pre-fill a one-word login or one with digits or symbols (QA-28)", () => {
    assert.equal(suggestedFullName({ USERNAME: "Alsaju" }), "");
    assert.equal(suggestedFullName({ USER: "sam" }), "");
    assert.equal(suggestedFullName({ USERNAME: "jsmith01" }), "");
    assert.equal(suggestedFullName({ USERNAME: "pat.example2" }), "");
    assert.equal(suggestedFullName({ USERNAME: "svc$backup" }), "");
  });
  it("suggests nothing for a missing or system name", () => {
    assert.equal(suggestedFullName({}), "");
    assert.equal(suggestedFullName({ USERNAME: "Administrator" }), "");
    assert.equal(suggestedFullName({ USERNAME: "SYSTEM" }), "");
  });
});

describe("loginNameHint", () => {
  it("shows the login as a name for the placeholder, even for one word", () => {
    assert.equal(loginNameHint({ USERNAME: "Alsaju" }), "Alsaju");
    assert.equal(loginNameHint({ USERNAME: "pat.example" }), "Pat Example");
    assert.equal(loginNameHint({ USER: "sam" }), "Sam");
  });
  it("is empty for a missing or system name", () => {
    assert.equal(loginNameHint({}), "");
    assert.equal(loginNameHint({ USERNAME: "admin" }), "");
  });
});

describe("initialFirstRunForm", () => {
  it("starts from the suggestion and the detected time zone", () => {
    const initial = initialFirstRunForm({
      suggestedName: "Pat Example",
      detectedTimeZone: "Europe/London",
    });
    assert.equal(initial.fullName, "Pat Example");
    assert.equal(initial.timeZone, "Europe/London");
    assert.equal(initial.inboxDir, "");
    assert.equal(initial.email, "");
  });
});

describe("timeZoneChoices", () => {
  it("sorts, de-duplicates and always includes the detected zone", () => {
    assert.deepEqual(timeZoneChoices(["UTC", "Asia/Kolkata", "UTC"], "Europe/London"), [
      "Asia/Kolkata",
      "Europe/London",
      "UTC",
    ]);
    assert.deepEqual(timeZoneChoices(["UTC"], ""), ["UTC"]);
  });
});

describe("suggestedDomain", () => {
  it("offers the work email's domain without writing it into the form", () => {
    const typed = form({ email: "Pat@US.Contoso.com", allowedDomains: "" });
    assert.equal(suggestedDomain(typed), "us.contoso.com");
    assert.equal(typed.allowedDomains, "");
  });
  it("offers nothing for a missing or malformed email", () => {
    assert.equal(suggestedDomain(form({ email: "nope" })), null);
    assert.equal(suggestedDomain(form({ email: "pat@deloitte.comdeloitte.com" })), null);
  });
});

describe("withSuggestedDomain", () => {
  it("fills the email's domain in when the domain box is empty", () => {
    const filled = withSuggestedDomain(
      form({ email: "Pat@US.Contoso.com", allowedDomains: "  " }),
    );
    assert.equal(filled.allowedDomains, "us.contoso.com");
  });
  it("keeps what the person typed, and does nothing for a bad email", () => {
    const typed = form({ allowedDomains: "other.com" });
    assert.equal(withSuggestedDomain(typed), typed);
    assert.equal(
      withSuggestedDomain(form({ email: "nope", allowedDomains: "" })).allowedDomains,
      "",
    );
  });
});

describe("stepProblems", () => {
  it("exposes four steps in order", () => {
    assert.deepEqual(
      FIRST_RUN_STEPS.map((s) => s.id),
      ["who", "timeZone", "domains", "inbox"],
    );
  });

  it("who: needs a valid email; the name is optional (Microsoft 365 brings it)", () => {
    assert.deepEqual(stepProblems("who", form()), []);
    assert.deepEqual(stepProblems("who", form({ fullName: "  " })), []);
    assert.match(stepProblems("who", form({ email: "pat" }))[0], /email/i);
    assert.match(stepProblems("who", form({ email: "" }))[0], /email/i);
  });

  it("timeZone: must be a zone Intl knows", () => {
    assert.deepEqual(stepProblems("timeZone", form()), []);
    assert.match(
      stepProblems("timeZone", form({ timeZone: "Mars/Base" }))[0],
      /time zone/i,
    );
  });

  it("domains: at least one allowed domain, all valid; blocked may be empty but valid", () => {
    assert.deepEqual(stepProblems("domains", form()), []);
    assert.match(
      stepProblems("domains", form({ allowedDomains: "" }))[0],
      /at least one/i,
    );
    assert.match(
      stepProblems("domains", form({ allowedDomains: "localhost" }))[0],
      /localhost/,
    );
    assert.match(
      stepProblems("domains", form({ blockedDomains: "bad domain!" }))[0],
      /bad/,
    );
  });

  it("who: refuses an address list in the single email box, and says why", () => {
    assert.match(
      stepProblems("who", form({ email: "Alex,A.Morgan" }))[0],
      /two addresses joined/,
    );
    assert.match(stepProblems("who", form({ email: "a@x.com b@x.com" }))[0], /joined/);
  });

  it("domains: flags a doubled domain and each bad entry, and accepts commas and newlines", () => {
    const doubled = stepProblems(
      "domains",
      form({ allowedDomains: "deloitte.comdeloitte.com" }),
    );
    assert.equal(doubled.length, 1);
    assert.match(doubled[0], /deloitte\.comdeloitte\.com.*typed twice/);
    const mixed = stepProblems(
      "domains",
      form({ allowedDomains: "a.com\nb.com, nope", blockedDomains: "x@y.com" }),
    );
    assert.equal(mixed.length, 2);
    assert.deepEqual(
      stepProblems("domains", form({ allowedDomains: "A.com;\n@b.com." })),
      [],
    );
  });

  it("inbox: needs an absolute path", () => {
    assert.deepEqual(stepProblems("inbox", form()), []);
    assert.match(stepProblems("inbox", form({ inboxDir: "" }))[0], /folder/i);
    assert.match(stepProblems("inbox", form({ inboxDir: "PMO-Inbox" }))[0], /full path/i);
  });
});

describe("firstRunPayload", () => {
  it("maps the form to the config pieces, name first, domains lower-cased", () => {
    const result = firstRunPayload(
      form({
        allowedDomains: "Contoso.com, us.contoso.com",
        blockedDomains: "Rival.com",
      }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.payload, {
      names: ["Pat Example", "Pat", "Example"],
      emails: ["pat@contoso.com"],
      timeZone: "Europe/London",
      allowedSenderDomains: ["contoso.com", "us.contoso.com"],
      blockedDomains: ["rival.com"],
      inboxDir: "C:\\Users\\pat\\OneDrive\\PMO-Inbox",
    });
  });

  it("does not repeat the full name among the other spellings", () => {
    const result = firstRunPayload(form({ otherNames: "pat example, Pat" }));
    assert.deepEqual(result.payload.names, ["Pat Example", "Pat"]);
  });

  it("lists every problem when the form is incomplete", () => {
    const result = firstRunPayload(form({ email: "x", timeZone: "", inboxDir: "" }));
    assert.equal(result.ok, false);
    assert.ok(result.problems.length >= 3);
  });

  it("calls you by the name in your address when no name is typed", () => {
    const result = firstRunPayload(
      form({ fullName: " ", otherNames: "", email: "jane.doe@deloitte.com" }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.payload.names, ["Jane Doe"]);
    assert.equal(nameToGoBy("alsaju@deloitte.com"), "Alsaju");
    assert.equal(nameToGoBy("jane_doe3@x.com"), "Jane Doe");
    assert.equal(nameToGoBy("42@x.com"), "42");
  });
});

describe("needsFirstRun", () => {
  it("is true until setupComplete is exactly true", () => {
    assert.equal(needsFirstRun({ setupComplete: false }), true);
    assert.equal(needsFirstRun({ setupComplete: true }), false);
    assert.equal(needsFirstRun(undefined), true);
  });
});

describe("inferSetupComplete (upgrade migration)", () => {
  const saved = {
    inboxDir: "C:\\OneDrive\\PMO-Inbox",
    me: { names: ["Pat"], emails: ["pat@contoso.com"] },
  };

  it("treats an old config with an owner email and an inbox as set up", () => {
    assert.equal(inferSetupComplete(saved), true);
  });

  it("respects an explicit value either way", () => {
    assert.equal(inferSetupComplete({ ...saved, setupComplete: false }), false);
    assert.equal(inferSetupComplete({ setupComplete: true }), true);
  });

  it("does not guess for a fresh, partial or damaged config", () => {
    assert.equal(inferSetupComplete(undefined), false);
    assert.equal(inferSetupComplete(null), false);
    assert.equal(inferSetupComplete([]), false);
    assert.equal(inferSetupComplete({}), false);
    assert.equal(inferSetupComplete({ ...saved, inboxDir: "  " }), false);
    assert.equal(
      inferSetupComplete({ ...saved, me: { names: ["Pat"], emails: [] } }),
      false,
    );
    assert.equal(
      inferSetupComplete({ ...saved, me: { names: ["Pat"], emails: [""] } }),
      false,
    );
    assert.equal(inferSetupComplete({ ...saved, me: "pat" }), false);
  });
});
