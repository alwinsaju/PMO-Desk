// Run with `pnpm test`. Which Settings tab holds which field.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIST_FIELDS } from "./settingsForm.ts";
import { SETTINGS_TABS, tabOfField, tabsWithProblems } from "./settingsTabs.ts";

describe("settings tabs", () => {
  it("are Me, Senders, Reminders and Teams (advanced), in that order", () => {
    assert.deepEqual(
      SETTINGS_TABS.map((tab) => tab.label),
      ["Me", "Senders", "Reminders", "Teams (advanced)"],
    );
  });

  it("puts every list field on a tab", () => {
    const placed = Object.fromEntries(
      LIST_FIELDS.map((field) => [field, tabOfField(field)]),
    );
    assert.deepEqual(placed, {
      names: "me",
      emails: "me",
      allowedSenderDomains: "senders",
      allowedTenantIds: "teams",
      teamsChatAllowlist: "teams",
      blockedDomains: "senders",
      blockedTerms: "senders",
    });
  });

  it("places the other fields by what they are about", () => {
    assert.equal(tabOfField("retentionDays"), "senders");
    assert.equal(tabOfField("report.title"), "me");
    assert.equal(tabOfField("report.projectName"), "me");
    assert.equal(tabOfField("reminders.workStart"), "reminders");
    assert.equal(tabOfField("reminders.timeZone"), "reminders");
  });
});

describe("tabsWithProblems", () => {
  it("lists the affected tabs once each, in tab order", () => {
    assert.deepEqual(
      tabsWithProblems(["reminders.workEnd", "emails", "reminders.workStart", "names"]),
      ["me", "reminders"],
    );
    assert.deepEqual(tabsWithProblems(["teamsChatAllowlist", "blockedTerms"]), [
      "senders",
      "teams",
    ]);
  });

  it("is empty when nothing is wrong", () => {
    assert.deepEqual(tabsWithProblems([]), []);
  });
});
