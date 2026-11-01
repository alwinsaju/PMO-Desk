// Run with `pnpm test`. The Settings dialog's form <-> config conversion and
// its inline validation messages (pure; no React).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { developerConfig } from "../../../lib/pmo/developerDefaults.ts";
import { buildPatch, formFromConfig } from "./settingsForm.ts";
import { PmoConfigSchema } from "../../../lib/pmo/types.ts";

const config = developerConfig();

describe("settings form", () => {
  it("shows empty boxes for a new install (neutral config), never a developer's values", () => {
    const form = formFromConfig(PmoConfigSchema.parse({}));
    for (const field of [
      "names",
      "emails",
      "allowedSenderDomains",
      "allowedTenantIds",
      "teamsChatAllowlist",
      "blockedDomains",
      "blockedTerms",
    ]) {
      assert.equal(form[field], "", field);
    }
  });

  it("round-trips the stored config into the same patch values", () => {
    const form = formFromConfig(config);
    assert.equal(form.allowedSenderDomains, "deloitte.com");
    assert.equal(form.retentionDays, "90");
    const built = buildPatch(form);
    assert.equal(built.errors, null);
    assert.deepEqual(built.patch.me.names, config.me.names);
    assert.deepEqual(built.patch.blockedDomains, ["takeda.com"]);
    assert.deepEqual(built.patch.allowedTenantIds, []);
    assert.equal(built.patch.retentionDays, 90);
  });

  it("ignores blank lines and trims entries", () => {
    const form = {
      ...formFromConfig(config),
      blockedTerms: "\n  Project Falcon  \n\n   \nSecret\n",
    };
    assert.deepEqual(buildPatch(form).patch.blockedTerms, ["Project Falcon", "Secret"]);
  });

  it("reports errors per field, naming the bad entry or the line of the box", () => {
    const form = {
      ...formFromConfig(config),
      allowedTenantIds: "00000000-0000-0000-0000-000000000000\n\nnot-a-guid",
      blockedDomains: "takeda.com\nnot a domain",
      emails: "alsaju@deloitte.com\nbroken",
      retentionDays: "abc",
    };
    const { patch, errors } = buildPatch(form);
    assert.equal(patch, null);
    assert.match(errors.allowedTenantIds, /^Line 3: Not a tenant ID/);
    assert.match(errors.blockedDomains, /^"not": Not a domain \(example: company\.com\)/);
    assert.match(errors.blockedDomains, /and 2 more/);
    assert.match(errors.emails, /^"broken": Not an email address/);
    assert.match(errors.retentionDays, /number of days/);
    assert.equal(errors.names, undefined);
  });

  it("refuses the QA-02 input: bad addresses and a doubled domain are errors, not saved", () => {
    const form = {
      ...formFromConfig(config),
      emails: "Alex,A.Morgan",
      allowedSenderDomains: "deloitte.comdeloitte.com",
    };
    const { patch, errors } = buildPatch(form);
    assert.equal(patch, null);
    assert.match(errors.emails, /^"Alex": Not an email address/);
    assert.match(errors.allowedSenderDomains, /typed twice/);
  });

  it("accepts commas, newlines and uppercase in the address and domain boxes, and normalises", () => {
    const form = {
      ...formFromConfig(config),
      emails: "Pat@Company.com, sam@company.com\nPAT@company.com",
      allowedSenderDomains: "@Company.com;\nus.company.com.",
    };
    const { patch, errors } = buildPatch(form);
    assert.equal(errors, null);
    assert.deepEqual(patch.me.emails, ["pat@company.com", "sam@company.com"]);
    assert.deepEqual(patch.allowedSenderDomains, ["company.com", "us.company.com"]);
  });

  it("needs at least one name, and a retention within bounds", () => {
    const noNames = buildPatch({ ...formFromConfig(config), names: "  \n" });
    assert.match(noNames.errors.names, /at least one name/i);
    assert.match(
      buildPatch({ ...formFromConfig(config), retentionDays: "3" }).errors.retentionDays,
      /At least 7/,
    );
    assert.match(
      buildPatch({ ...formFromConfig(config), retentionDays: "" }).errors.retentionDays,
      /number of days/,
    );
    assert.equal(
      buildPatch({ ...formFromConfig(config), retentionDays: " 30 " }).patch
        .retentionDays,
      30,
    );
  });

  it("carries the reminder preferences, with defaults that match the engine", () => {
    const form = formFromConfig(config);
    assert.equal(form.reminders.chaserDays, "2");
    assert.equal(form.reminders.leadWorkingDays, "1");
    assert.equal(form.reminders.hideDetails, true);
    assert.equal(form.reminders.keepRunningInTray, false);
    const built = buildPatch(form);
    assert.equal(built.errors, null);
    assert.deepEqual(built.patch.reminders, config.reminders);
  });

  it("validates the reminder fields next to the field", () => {
    const base = formFromConfig(config);
    const bad = (patch) =>
      buildPatch({ ...base, reminders: { ...base.reminders, ...patch } });
    assert.match(
      bad({ timeZone: "Mars/Olympus" }).errors["reminders.timeZone"],
      /time zone/i,
    );
    assert.match(bad({ workStart: "20:00" }).errors["reminders.workEnd"], /end after/i);
    assert.match(bad({ chaserDays: "" }).errors["reminders.chaserDays"], /number/i);
    assert.match(bad({ chaserDays: "0" }).errors["reminders.chaserDays"], /At least 1/);
    assert.match(bad({ workDays: [] }).errors["reminders.workDays"], /at least one/i);
    assert.equal(bad({ chaserDays: " 3 ", digest: true }).patch.reminders.chaserDays, 3);
    assert.match(
      bad({ leadWorkingDays: "" }).errors["reminders.leadWorkingDays"],
      /number/i,
    );
    assert.match(
      bad({ leadWorkingDays: "6" }).errors["reminders.leadWorkingDays"],
      /At most 5/,
    );
    assert.match(
      bad({ leadWorkingDays: "1.5" }).errors["reminders.leadWorkingDays"],
      /whole/i,
    );
    assert.equal(bad({ leadWorkingDays: "0" }).patch.reminders.leadWorkingDays, 0);
    assert.equal(bad({ leadWorkingDays: " 2 " }).patch.reminders.leadWorkingDays, 2);
  });
  it("carries the weekly report heading and checks it", () => {
    const base = formFromConfig(config);
    assert.equal(base.reportTitle, "Weekly status");
    assert.equal(base.reportProject, "");
    const ok = buildPatch({
      ...base,
      reportTitle: "  Programme status ",
      reportProject: " Atlas ",
    });
    assert.deepEqual(ok.patch.report, {
      title: "Programme status",
      projectName: "Atlas",
    });
    assert.equal(buildPatch(base).patch.report.title, "Weekly status");
    assert.match(
      buildPatch({ ...base, reportTitle: "  " }).errors["report.title"],
      /Enter a title/,
    );
    assert.match(
      buildPatch({ ...base, reportProject: "x".repeat(81) }).errors["report.projectName"],
      /At most 80/,
    );
  });
});
