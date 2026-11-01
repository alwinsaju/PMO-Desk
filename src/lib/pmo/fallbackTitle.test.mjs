// Run with `pnpm test`. The deterministic fallback titles (fallbackTitle.ts):
// pure, no model, no I/O.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FALLBACK_TITLE,
  deriveFallbackTitle,
  firstMeaningfulSentence,
  isPoorTitle,
  isSalutationOnly,
} from "./fallbackTitle.ts";

const title = (subject, bodyText = "") => deriveFallbackTitle({ subject, bodyText });

describe("deriveFallbackTitle: the subject comes first", () => {
  it("uses the subject, trimmed and on one line", () => {
    assert.equal(title("  Aging report   for week 44 \n"), "Aging report for week 44");
  });

  it("strips reply, forward and gateway prefixes, however many", () => {
    assert.equal(title("RE: Aging report"), "Aging report");
    assert.equal(title("Re: RE: re: Aging report"), "Aging report");
    assert.equal(title("FW: Aging report"), "Aging report");
    assert.equal(title("Fwd: Aging report"), "Aging report");
    assert.equal(title("[External] RE: Aging report"), "Aging report");
    assert.equal(title("RE: [EXTERNAL] Fwd: Aging report"), "Aging report");
    assert.equal(title("AW: Bericht"), "Bericht");
    assert.equal(title("TR : Rapport hebdomadaire"), "Rapport hebdomadaire");
  });

  it("keeps a bracket or word that is part of the subject", () => {
    assert.equal(title("[Project X] Budget"), "[Project X] Budget");
    assert.equal(title("Regarding: the budget"), "Regarding: the budget");
    assert.equal(title("Reconcile the ledger"), "Reconcile the ledger");
    assert.equal(title("Fwdlooking plan"), "Fwdlooking plan");
  });

  it("keeps an emoji and never cuts one in half", () => {
    assert.equal(title("🚀 Launch checklist"), "🚀 Launch checklist");
    const long = `${"a".repeat(198)}🚀🚀🚀`;
    const out = title(long);
    assert.ok(Array.from(out).length <= MAX_FALLBACK_TITLE);
    assert.ok(!/[\ud800-\udbff]$/.test(out), "no lone surrogate at the end");
    assert.ok(out.endsWith("…"));
  });

  it("caps a 500-character subject at 200 characters, at a word, with an ellipsis", () => {
    const subject = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    assert.ok(subject.length > 500);
    const out = title(subject);
    assert.ok(out.length <= MAX_FALLBACK_TITLE);
    assert.ok(out.endsWith("…"));
    assert.match(out.slice(0, -1), /word\d+$/);
    assert.equal(title("x".repeat(500)).length, MAX_FALLBACK_TITLE);
  });

  it("honours a smaller cap", () => {
    assert.equal(deriveFallbackTitle({ subject: "a".repeat(300) }, 90).length, 90);
  });

  it("does not use a greeting as the subject", () => {
    assert.equal(title("Hi,", "Could you send the plan?"), "Could you send the plan?");
  });
});

describe("deriveFallbackTitle: no subject, so the first meaningful sentence", () => {
  it("skips an English greeting line", () => {
    assert.equal(
      title("", "Hi Alex,\n\nCould you send me the consolidated RAID log by Friday?"),
      "Could you send me the consolidated RAID log by Friday?",
    );
  });

  it("skips a greeting on the same line", () => {
    assert.equal(
      title("", "Hi Alex, could you review the deck."),
      "could you review the deck",
    );
    assert.equal(
      title("", "Hello team! The pack needs sign-off today."),
      "The pack needs sign-off today",
    );
    assert.equal(
      title("", "Dear Mr. Smith, please confirm the invoice."),
      "please confirm the invoice",
    );
    assert.equal(
      title("", "Hi Alex - can you update the tracker?"),
      "can you update the tracker?",
    );
  });

  it("skips French greetings", () => {
    assert.equal(
      title("", "Bonjour,\n\nPouvez-vous envoyer le rapport avant vendredi ?"),
      "Pouvez-vous envoyer le rapport avant vendredi ?",
    );
    assert.equal(
      title("", "Bonjour Madame, Monsieur,\nMerci de valider le budget."),
      "Merci de valider le budget",
    );
    assert.equal(
      title("", "Salut Marie, tu peux relire le document ?"),
      "tu peux relire le document ?",
    );
    assert.equal(
      title("", "Bonsoir à tous,\n\nLa réunion est déplacée à jeudi."),
      "La réunion est déplacée à jeudi",
    );
  });

  it("skips a bare name line such as 'Rohan,'", () => {
    assert.equal(
      title("", "Rohan,\n\nPlease share the aging report."),
      "Please share the aging report",
    );
    assert.equal(
      title("", "Rohan Mehta,\nPlease share the aging report."),
      "Please share the aging report",
    );
    assert.equal(
      title("", "Alex and Priya,\nPlease share the aging report."),
      "Please share the aging report",
    );
  });

  it("skips pleasantries and thank-yous", () => {
    assert.equal(
      title("", "Hi,\n\nI hope you are doing well. Please book the room for Thursday."),
      "Please book the room for Thursday",
    );
    assert.equal(
      title("", "Hello,\n\nJ'espère que vous allez bien. Merci de réserver la salle."),
      "Merci de réserver la salle",
    );
  });

  it("joins a hard-wrapped first sentence", () => {
    assert.equal(
      title("", "Hi,\nCould you please send the\nquarterly numbers to Rahul?"),
      "Could you please send the quarterly numbers to Rahul?",
    );
  });

  it("stops at a quoted reply, a signature and a closing", () => {
    assert.equal(
      title(
        "",
        "Hi,\n\nOn Mon, 5 Oct 2026 at 10:00, Alwin wrote:\n> Please send the plan.",
      ),
      "",
    );
    assert.equal(
      title(
        "",
        "Hi,\n\nPlease send the plan.\n\nOn Mon, 5 Oct 2026 at 10:00, Alwin wrote:\n> Old text.",
      ),
      "Please send the plan",
    );
    assert.equal(title("", "Hi Sam,\n\nThanks,\nRohan\n\nPlease ignore this."), "");
    assert.equal(title("", "Thanks!\n\nSent from my iPhone"), "");
    assert.equal(
      title("", "> quoted line\nPlease send the plan."),
      "Please send the plan",
    );
    assert.equal(
      title("", "Please send the plan.\n-----Original Message-----\nFrom: A\nSent: B"),
      "Please send the plan",
    );
    assert.equal(
      title("", "Please send the plan.\n-- \nRohan Mehta\nPMO"),
      "Please send the plan",
    );
    assert.equal(title("", "Le 5 oct. 2026 à 10:00, Marie a écrit :\n> Bonjour"), "");
    assert.equal(
      title("", "Fine.\nFrom: Rohan Mehta\nSent: Monday\nTo: Alex\nSubject: x"),
      "Fine",
    );
  });

  it("keeps a sentence that merely starts like a closing", () => {
    assert.equal(
      title("", "Thanks for sending the report, can you also add Q3?"),
      "Thanks for sending the report, can you also add Q3?",
    );
  });

  it("copes with CRLF line endings", () => {
    assert.equal(
      title("", "Hi,\r\n\r\nPlease send the plan.\r\n"),
      "Please send the plan",
    );
  });

  it("returns an empty string when there is nothing to use", () => {
    assert.equal(title(""), "");
    assert.equal(title("RE:", ""), "");
    assert.equal(title("   ", "Hi,\n\nThanks,\nRohan"), "");
    assert.equal(title(null, undefined), "");
  });
});

describe("firstMeaningfulSentence", () => {
  it("keeps the punctuation as written", () => {
    assert.equal(
      firstMeaningfulSentence("Hi,\n\nPlease send the plan. Then relax."),
      "Please send the plan.",
    );
  });
  it("is empty for a greeting-only body", () => {
    assert.equal(firstMeaningfulSentence("Hi,"), "");
    assert.equal(firstMeaningfulSentence("Bonjour,\n"), "");
  });
});

describe("isSalutationOnly", () => {
  it("recognises greetings and bare names", () => {
    for (const text of [
      "Hi,",
      "Hi",
      "Hello,",
      "Hey!",
      "Dear Rohan,",
      "Dear Sir or Madam,",
      "Hi Alex,",
      "Hi all,",
      "Good morning,",
      "Good morning team,",
      "Bonjour,",
      "Bonjour à tous,",
      "Bonjour Madame, Monsieur,",
      "Salut Marie,",
      "Rohan,",
      "Rohan Mehta,",
      "Hi,\n\nRohan,",
    ]) {
      assert.equal(isSalutationOnly(text), true, text);
    }
  });

  it("does not treat a request as a greeting", () => {
    for (const text of [
      "",
      "Hi Alex, could you send the plan?",
      "Hello team I need the report by Friday please",
      "Highlights for the week",
      "Send the plan",
      "Hey there, is the build green?",
    ]) {
      assert.equal(isSalutationOnly(text), false, text);
    }
  });
});

describe("isPoorTitle", () => {
  const names = ["Rohan Mehta", "rohan.mehta@example.com", "Alex Morgan"];

  it("flags empty, symbol-only and greeting titles", () => {
    for (const t of ["", "   ", "...", "🔥", "Hi,", "Bonjour,", "Rohan,", "Hi Alex,"]) {
      assert.equal(isPoorTitle(t), true, t);
    }
  });

  it("flags a title that is only the sender's or the user's name", () => {
    for (const t of [
      "Rohan Mehta",
      "rohan",
      "ROHAN MEHTA",
      "Mehta",
      "Alex Morgan",
      "Alex",
    ]) {
      assert.equal(isPoorTitle(t, names), true, t);
    }
    assert.equal(isPoorTitle("Rohan", []), false);
  });

  it("ignores accents when comparing names", () => {
    assert.equal(isPoorTitle("Zoë", ["Zoe Martin"]), true);
  });

  it("accepts a real title", () => {
    for (const t of [
      "Send the RAID log",
      "Aging report for week 44",
      "Rohan's invoice",
    ]) {
      assert.equal(isPoorTitle(t, names), false, t);
    }
  });
});
