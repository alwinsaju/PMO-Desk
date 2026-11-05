// Run with `pnpm test`. The name and initials the lock screen shows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstNameFromAccount,
  initialsOf,
  resolveIdentity,
  welcomeLine,
} from "./userIdentity.ts";

describe("firstNameFromAccount", () => {
  it("takes the first word of the account, capitalised", () => {
    assert.equal(firstNameFromAccount("priya.sharma"), "Priya");
    assert.equal(firstNameFromAccount("ACME\\ALEX_J"), "Alex");
    assert.equal(firstNameFromAccount("sam-lee"), "Sam");
  });

  it("gives nothing for generic or empty accounts", () => {
    for (const bad of [
      "Administrator",
      "admin",
      "root",
      "",
      null,
      undefined,
      "x",
      "123",
    ]) {
      assert.equal(firstNameFromAccount(bad), "");
    }
  });
});

describe("initialsOf", () => {
  it("uses first and last word", () => {
    assert.equal(initialsOf("Priya Sharma"), "PS");
    assert.equal(initialsOf("  aarav  k  singh "), "AS");
    assert.equal(initialsOf("Alex"), "A");
    assert.equal(initialsOf("  "), "");
  });
});

describe("resolveIdentity", () => {
  it("prefers the configured PMO name", () => {
    assert.deepEqual(
      resolveIdentity({ pmoNames: ["", " Priya Sharma "], account: "alex" }),
      { name: "Priya Sharma", initials: "PS" },
    );
  });

  it("falls back to the computer account, then to nothing", () => {
    assert.deepEqual(resolveIdentity({ pmoNames: [], account: "alex.jones" }), {
      name: "Alex",
      initials: "A",
    });
    assert.deepEqual(resolveIdentity({ account: "Administrator" }), {
      name: "",
      initials: "",
    });
  });

  it("prefers your roster profile: the M365 full name and photo", () => {
    assert.deepEqual(
      resolveIdentity({
        self: { name: " Priya Sharma ", photoUrl: "/api/staff/photos/emp_1?v=3" },
        pmoNames: ["Pri"],
        account: "psharma",
      }),
      { name: "Priya Sharma", initials: "PS", photoUrl: "/api/staff/photos/emp_1?v=3" },
    );
  });

  it("leaves the photo out until there is one, and ignores an empty roster name", () => {
    assert.deepEqual(
      resolveIdentity({ self: { name: "", photoUrl: "" }, pmoNames: ["Pat Example"] }),
      { name: "Pat Example", initials: "PE" },
    );
    assert.equal("photoUrl" in resolveIdentity({ self: null, account: "alex" }), false);
  });
});

describe("welcomeLine", () => {
  it("says Welcome on a brand-new profile and Welcome back afterwards", () => {
    assert.equal(welcomeLine("Priya", true), "Welcome");
    assert.equal(welcomeLine("Priya", false), "Welcome back");
    assert.equal(welcomeLine("", false), "");
  });
});
