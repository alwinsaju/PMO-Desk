import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  joinRecipients,
  recipientError,
  recipientsProblem,
  splitRecipients,
  tidyRecipients,
} from "./recipients.ts";
import { STARTERS } from "./starters.ts";

const SREELA = "Peethambaram, Sreela <speethambaram@deloitte.com>";
const RUPA = "Atchula, Rupavani <ratchula@deloitte.com>";

describe("splitRecipients", () => {
  it("splits on semicolons and keeps 'Last, First' names whole", () => {
    assert.deepEqual(splitRecipients(`${SREELA}; ${RUPA}`), [SREELA, RUPA]);
  });
  it("splits on commas and new lines only between addresses", () => {
    assert.deepEqual(splitRecipients("a@x.com, b@x.com,c@x.com\nd@x.com"), [
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
    assert.deepEqual(splitRecipients(`${SREELA}, ${RUPA}`), [SREELA, RUPA]);
  });
  it("keeps a quoted name with a comma and ignores blanks", () => {
    assert.deepEqual(splitRecipients('"Doe, Jo" <jo@x.com>;; ;'), [
      '"Doe, Jo" <jo@x.com>',
    ]);
    assert.deepEqual(splitRecipients("  "), []);
  });
  it("reads every starter template's saved lines back unchanged", () => {
    for (const starter of STARTERS) {
      for (const line of [starter.to, starter.cc]) {
        assert.equal(joinRecipients(splitRecipients(line)), line);
      }
    }
  });
});

describe("tidyRecipients", () => {
  it("splits pasted lists and drops repeats", () => {
    assert.deepEqual(tidyRecipients(["a@x.com, B@x.com", "b@x.com", "c@x.com"]), [
      "a@x.com",
      "B@x.com",
      "c@x.com",
    ]);
  });
});

describe("recipientError", () => {
  it("accepts bare and bracketed addresses and placeholders", () => {
    assert.equal(recipientError("a@x.com"), null);
    assert.equal(recipientError(SREELA), null);
    assert.equal(recipientError("{{owner_email}}"), null);
    assert.equal(recipientError("Team <{{team_email}}>"), null);
  });
  it("refuses a name with no address", () => {
    assert.equal(recipientError("Support team"), "Not an email address");
    assert.equal(recipientError("a@b"), "Not an email address");
    assert.equal(recipientError("Name <nope>"), "Not an email address");
  });
});

describe("recipientsProblem", () => {
  it("is null for an empty or good line and names what is wrong otherwise", () => {
    assert.equal(recipientsProblem(""), null);
    assert.equal(recipientsProblem(`${SREELA}; ${RUPA}`), null);
    assert.match(recipientsProblem("Support team"), /“Support team” is not an email/);
    assert.match(recipientsProblem("a; b"), /2 entries are not email addresses/);
  });
});
