// Run with `pnpm test`. What the first-run wizard says about its progress and answers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIRST_RUN_STEPS, initialFirstRunForm } from "./firstRun.ts";
import {
  STEP_ICON,
  STEP_INTRO,
  STEP_SHORT,
  nextSteps,
  wizardProgress,
  wizardSummary,
} from "./wizardView.ts";

const form = {
  ...initialFirstRunForm({ suggestedName: "", detectedTimeZone: "Asia/Kolkata" }),
  fullName: "Pat Example",
  otherNames: "Pat, P. Example",
  email: "pat@company.com",
  allowedDomains: "company.com, partner.example",
  blockedDomains: "",
  inboxDir: "C:\\Users\\pat\\OneDrive\\PMO-Inbox",
};

describe("wizardProgress", () => {
  it("counts steps from one and fills the bar up to the current step", () => {
    assert.deepEqual(wizardProgress(0, 4), { label: "Step 1 of 4", percent: 25 });
    assert.deepEqual(wizardProgress(3, 4), { label: "Step 4 of 4", percent: 100 });
  });

  it("stays inside the range for a stray index", () => {
    assert.equal(wizardProgress(-2, 4).label, "Step 1 of 4");
    assert.equal(wizardProgress(9, 4).label, "Step 4 of 4");
  });
});

describe("step wording", () => {
  it("gives every step its own short name and intro, none repeated", () => {
    for (const { id } of FIRST_RUN_STEPS) {
      assert.ok(STEP_SHORT[id], `short name for ${id}`);
      assert.ok(STEP_INTRO[id], `intro for ${id}`);
    }
    const intros = FIRST_RUN_STEPS.map(({ id }) => STEP_INTRO[id]);
    assert.equal(new Set(intros).size, intros.length);
  });
});

describe("step pictures", () => {
  it("gives every step an icon", () => {
    for (const { id } of FIRST_RUN_STEPS) assert.ok(STEP_ICON[id], `icon for ${id}`);
  });
});

describe("nextSteps", () => {
  it("lists what happens next, in order, naming the folder and domains", () => {
    const steps = nextSteps(form);
    assert.deepEqual(
      steps.map((s) => s.icon),
      ["folder", "robot", "review", "bell"],
    );
    assert.match(steps[0].text, /OneDrive\\PMO-Inbox/);
    assert.match(steps[1].text, /company\.com, partner\.example/);
    assert.match(steps[2].text, /Nothing becomes a to-do until you approve/);
  });

  it("stays readable when the folder or domains are not in the form", () => {
    const steps = nextSteps({ ...form, inboxDir: " ", allowedDomains: "" });
    assert.doesNotMatch(steps[0].text, /undefined|\s{2,}/);
    assert.doesNotMatch(steps[1].text, /undefined|from \s/);
  });

  it("ignores a malformed domain instead of listing it", () => {
    const steps = nextSteps({ ...form, allowedDomains: "company.com, not a domain" });
    assert.match(steps[1].text, /^Mail from company\.com is read/);
  });
});

describe("wizardSummary", () => {
  it("lists the answers with the step each one is changed on", () => {
    const rows = wizardSummary(form);
    assert.deepEqual(
      rows.map((r) => [r.label, r.step]),
      [
        ["Name", "who"],
        ["Email", "who"],
        ["Time zone", "timeZone"],
        ["Allowed domains", "domains"],
        ["Blocked domains", "domains"],
        ["Inbox folder", "inbox"],
      ],
    );
    assert.equal(rows[0].value, "Pat Example (also Pat, P. Example)");
    assert.equal(rows[3].value, "company.com, partner.example");
    assert.equal(rows[4].value, "None");
  });

  it("says plainly what is missing", () => {
    const rows = wizardSummary({ ...form, fullName: " ", email: "", inboxDir: "" });
    assert.equal(rows[0].value, "Not set");
    assert.equal(rows[1].value, "Not set");
    assert.equal(rows[5].value, "Not set");
  });

  it("says the name comes from Microsoft 365 when only the email is given", () => {
    const rows = wizardSummary({ ...form, fullName: " ", otherNames: "" });
    assert.equal(rows[0].value, "From your Microsoft 365 profile");
  });
});
