// Run with `pnpm test`. Who an opening salutation names, and whether that is not the user.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addresseesOf, addressedToSomeoneElse } from "./addressee.ts";

const me = { names: ["Alex Morgan", "Alex"], emails: ["alex.morgan@deloitte.com"] };

describe("addresseesOf", () => {
  it("reads a bare name line and a greeting with a name", () => {
    assert.deepEqual(addresseesOf("Rohan,\n\nThe list needs your sign-off."), ["Rohan"]);
    assert.deepEqual(addresseesOf("Hi Rohan,\nplease check"), ["Rohan"]);
    assert.deepEqual(addresseesOf("Bonjour Zoë,\n\nMerci"), ["Zoë"]);
    assert.deepEqual(addresseesOf("Dear Priya Nair,\nplease"), ["Priya Nair"]);
  });

  it("splits several people", () => {
    assert.deepEqual(addresseesOf("Hi Rohan and Priya,\nplease"), ["Rohan", "Priya"]);
    assert.deepEqual(addresseesOf("Rohan & Priya,\nplease"), ["Rohan", "Priya"]);
  });

  it("names nobody for a group, a bare greeting or no greeting", () => {
    assert.deepEqual(addresseesOf("Hi team,\nplease"), []);
    assert.deepEqual(addresseesOf("Hello all,\nplease"), []);
    assert.deepEqual(addresseesOf("Hi,\nplease"), []);
    assert.deepEqual(addresseesOf("Bonjour,\nmerci"), []);
    assert.deepEqual(addresseesOf("Please send the report by Friday."), []);
    assert.deepEqual(addresseesOf("Just an FYI - the office is closed."), []);
    assert.deepEqual(addresseesOf(""), []);
  });

  it("ignores a greeting that is really a sentence", () => {
    assert.deepEqual(addresseesOf("Hi, could you send the report?"), []);
    assert.deepEqual(addresseesOf("Hi Alex, could you send the report?"), ["Alex"]);
  });
});

describe("addressedToSomeoneElse", () => {
  it("is the other person when the greeting names someone who is not me", () => {
    assert.deepEqual(addressedToSomeoneElse("Rohan,\n\nplease sign off", me), ["Rohan"]);
    assert.deepEqual(addressedToSomeoneElse("Hi Rohan and Priya,\nplease", me), [
      "Rohan",
      "Priya",
    ]);
  });

  it("is null when the greeting names me, by a name, a first name or an address part", () => {
    assert.equal(addressedToSomeoneElse("Hi Alex,\nplease", me), null);
    assert.equal(addressedToSomeoneElse("Hi Alex Morgan,\nplease", me), null);
    assert.equal(addressedToSomeoneElse("Hi Morgan,\nplease", me), null);
    assert.equal(addressedToSomeoneElse("Hi Rohan and Alex,\nplease", me), null);
  });

  it("is null when nobody is named", () => {
    assert.equal(addressedToSomeoneElse("Hi team,\nplease", me), null);
    assert.equal(addressedToSomeoneElse("Please send it", me), null);
  });
});
