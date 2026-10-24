// Run with `pnpm test`. The view-models behind the sign-off parts of the PMO
// window: the panel on an approval checkpoint (state, wording, stamp, actions), the
// record form's checks, the evidence choices, the approver quick picks and the
// badge on a list row. Pure, fictional data. Nothing here sends anything.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  recordSignoff,
  requestSignoff,
  revokeSignoff,
} from "../../../lib/pmo/signoff.ts";
import { buildTodo, emptyDraft } from "../../../lib/pmo/todoLogic.ts";
import { defaultReminderPrefs } from "../../../lib/pmo/types.ts";
import {
  OUTCOME_CHOICES,
  approverSuggestions,
  conditionsField,
  emptyRecordForm,
  evidenceOptions,
  recordFormProblem,
  revokeProblem,
  safeHttpsLink,
  signoffBadgeText,
  signoffPanelView,
  signoffRowView,
  stampTime,
} from "./signoffUi.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const prefs = defaultReminderPrefs();
const ist = (stamp) => new Date(`${stamp}:00+05:30`);
const T0 = "2026-10-26T05:00:00.000Z"; // Mon 10:30 IST
const T1 = "2026-10-27T05:00:00.000Z";
const SOURCE = {
  intakeId: "in_source",
  source: "outlook",
  link: null,
  subject: "Q4 pack",
  sender: "Pat Sample",
  receivedAt: T0,
  threadKey: null,
};
const fresh = () =>
  buildTodo(
    { ...emptyDraft("Sign off the pack"), checkpointTemplate: "approval" },
    { now: "2026-10-26T03:30:00.000Z", approvedBy: "tester", source: SOURCE },
  );
const must = (r) => {
  assert.equal(r.ok, true, r.reason);
  return r.todo;
};
const requested = () =>
  must(
    requestSignoff(fresh(), {
      approver: "Jordan Sample (jordan.sample@deloitte.com)",
      now: T0,
      by: "alsaju",
    }),
  );
const approvalOf = (todo) => todo.checkpoints.find((c) => c.kind === "approval");
const panel = (todo, now = ist("2026-10-27T11:00"), open = true) =>
  signoffPanelView(todo, approvalOf(todo), now, prefs, open);
const EVIDENCE = {
  intakeId: "in_reply",
  messageLink: "https://outlook.office.com/m/1",
  note: "email from Jordan",
};

describe("the panel on a sign-off step", () => {
  it("not requested: invites a request and allows recording one", () => {
    const view = panel(fresh());
    assert.equal(view.state, "not_requested");
    assert.equal(view.headline, "Sign-off not requested yet");
    assert.equal(view.approverLine, "Approver: not named yet");
    assert.equal(view.requestedLine, null);
    assert.deepEqual(view.actions, {
      request: "Request sign-off",
      record: true,
      confirmConditions: false,
      revoke: false,
    });
    assert.equal(view.stamp, null);
  });

  it("awaiting: who, since when, nothing sent by the app; 'Request again'; chase flag past the cadence", () => {
    const view = panel(requested(), ist("2026-10-27T11:00"));
    assert.equal(view.state, "awaiting");
    assert.equal(view.headline, "Awaiting sign-off from Jordan Sample for 1 day");
    assert.equal(view.approverLine, "Approver: Jordan Sample");
    assert.match(
      view.requestedLine,
      /Marked as sent .* IST by alsaju\. Nothing was sent by this app\./,
    );
    assert.equal(view.chase, false);
    assert.equal(view.actions.request, "Request again");
    assert.equal(view.actions.record, true);
    assert.equal(view.actions.revoke, false);
    const late = panel(requested(), ist("2026-10-29T11:00"));
    assert.equal(late.chase, true);
    assert.equal(late.tone, "strong");
    assert.match(late.next, /time to follow up/);
  });

  it("approved: the immutable stamp, who recorded it, when, the evidence; only Revoke is offered", () => {
    const todo = must(
      recordSignoff(requested(), {
        outcome: "approved",
        evidence: EVIDENCE,
        now: T1,
        by: "alsaju",
      }),
    );
    const view = panel(todo);
    assert.equal(view.state, "approved");
    assert.equal(view.headline, "Signed off by Jordan Sample");
    assert.deepEqual(view.stamp, {
      label: "Signed off by",
      signedBy: "Jordan Sample",
      recordedBy: "alsaju",
      recordedAt: stampTime(T1),
      evidenceNote: "email from Jordan",
      evidenceIntakeId: "in_reply",
      evidenceLink: "https://outlook.office.com/m/1",
      evidenceLinkText: "https://outlook.office.com/m/1",
    });
    assert.match(view.stamp.recordedAt, /27 Oct 2026, 10:30 IST/);
    assert.deepEqual(view.actions, {
      request: null,
      record: false,
      confirmConditions: false,
      revoke: true,
    });
  });

  it("with conditions: shows them, offers 'conditions are met' and Revoke, not a new request", () => {
    const todo = must(
      recordSignoff(requested(), {
        outcome: "approved_with_conditions",
        conditions: "Add the risk table",
        evidence: EVIDENCE,
        now: T1,
        by: "alsaju",
      }),
    );
    const view = panel(todo);
    assert.equal(view.state, "conditions");
    assert.equal(view.headline, "Approved with conditions by Jordan Sample");
    assert.deepEqual(view.said, { label: "Conditions", text: "Add the risk table" });
    assert.equal(view.actions.confirmConditions, true);
    assert.equal(view.actions.revoke, true);
    assert.equal(view.actions.request, null);
    assert.match(view.next, /stays open until you confirm/);
  });

  it("changes requested and rejected: visible, say the Draft is reopened, offer a new request and Revoke", () => {
    for (const [outcome, headline, label] of [
      ["changes_requested", "Changes requested by Jordan Sample", "Changes asked for"],
      ["rejected", "Rejected by Jordan Sample", "Reason given"],
    ]) {
      const todo = must(
        recordSignoff(requested(), {
          outcome,
          conditions: "Fix the budget slide",
          evidence: EVIDENCE,
          now: T1,
          by: "alsaju",
        }),
      );
      const view = panel(todo);
      assert.equal(view.headline, headline);
      assert.equal(view.said.label, label);
      assert.equal(view.actions.request, "Request sign-off again");
      assert.equal(view.actions.revoke, true);
      assert.match(view.next, /Draft step is reopened/);
    }
  });

  it("a revoked sign-off shows the earlier record with its reason", () => {
    const approved = must(
      recordSignoff(requested(), {
        outcome: "approved",
        evidence: EVIDENCE,
        now: T1,
        by: "alsaju",
      }),
    );
    const revoked = must(
      revokeSignoff(approved, {
        reason: "Wrong pack",
        now: "2026-10-28T05:00:00.000Z",
        by: "alsaju",
      }),
    );
    const view = panel(revoked);
    assert.equal(view.state, "not_requested");
    assert.equal(view.previous.length, 1);
    assert.match(
      view.previous[0],
      /^Approved, recorded by alsaju .*; revoked by alsaju .*: Wrong pack\.$/,
    );
  });

  it("a closed to-do shows the state and offers nothing; skipped and pre-phase-6 steps explain themselves", () => {
    const closed = panel(requested(), ist("2026-10-27T11:00"), false);
    assert.equal(closed.state, "awaiting");
    assert.deepEqual(closed.actions, {
      request: null,
      record: false,
      confirmConditions: false,
      revoke: false,
    });
    const skipped = fresh();
    skipped.checkpoints = skipped.checkpoints.map((c) =>
      c.kind === "approval" ? { ...c, state: "skipped" } : c,
    );
    assert.equal(panel(skipped).headline, "Sign-off skipped");
    const legacy = fresh();
    legacy.checkpoints = legacy.checkpoints.map((c) =>
      c.kind === "approval" ? { ...c, state: "done" } : c,
    );
    const view = panel(legacy);
    assert.equal(view.state, "legacy_done");
    assert.match(view.headline, /without a sign-off record/);
    assert.equal(view.actions.request, null);
  });
});

describe("the record form", () => {
  it("needs where it came from; conditions or changes where they are the point", () => {
    const form = emptyRecordForm();
    assert.match(recordFormProblem(form), /where the sign-off came from/);
    assert.equal(recordFormProblem({ ...form, note: "email from Jordan" }), null);
    assert.equal(
      recordFormProblem({ ...form, intakeId: "in_reply" }),
      null,
      "a linked message is evidence",
    );
    assert.match(
      recordFormProblem({ ...form, note: "x", outcome: "approved_with_conditions" }),
      /conditions/,
    );
    assert.match(
      recordFormProblem({ ...form, note: "x", outcome: "changes_requested" }),
      /changes/,
    );
    assert.equal(
      recordFormProblem({ ...form, note: "x", outcome: "rejected" }),
      null,
      "a reason is optional for a rejection",
    );
    assert.equal(
      recordFormProblem({
        ...form,
        note: "x",
        outcome: "changes_requested",
        conditions: "Fix it",
      }),
      null,
    );
    assert.match(recordFormProblem({ ...form, note: "x".repeat(501) }), /too long/);
  });

  it("offers the four outcomes and shows the text field only where it applies", () => {
    assert.deepEqual(
      OUTCOME_CHOICES.map((c) => c.value),
      ["approved", "approved_with_conditions", "changes_requested", "rejected"],
    );
    assert.equal(conditionsField("approved").shown, false);
    assert.deepEqual(conditionsField("approved_with_conditions"), {
      label: "Conditions",
      required: true,
      shown: true,
    });
    assert.equal(conditionsField("rejected").required, false);
  });

  it("a revoke needs a reason", () => {
    assert.match(revokeProblem(""), /reason/);
    assert.match(revokeProblem("ab"), /reason/);
    assert.equal(revokeProblem("Wrong pack"), null);
    assert.match(revokeProblem("x".repeat(301)), /too long/);
  });

  it("evidence can point at the source message and the messages linked into the timeline", () => {
    const todo = {
      source: { ...SOURCE, intakeId: "in_source" },
      history: [
        {
          id: "h1",
          at: T0,
          kind: "created",
          text: "Created",
          intakeId: "in_source",
          from: "Pat Sample",
        },
        {
          id: "h2",
          at: T1,
          kind: "message",
          text: "Reply",
          intakeId: "in_reply",
          from: "Jordan Sample",
        },
        {
          id: "h3",
          at: T1,
          kind: "waiting",
          text: "Waiting",
          intakeId: null,
          from: null,
        },
      ],
    };
    const options = evidenceOptions(todo);
    assert.deepEqual(
      options.map((o) => o.value),
      ["", "in_source", "in_reply"],
    );
    assert.equal(options[1].label, "Original message from Pat Sample");
    assert.match(options[2].label, /^Message from Jordan Sample, 27 Oct 2026$/);
    assert.deepEqual(
      evidenceOptions({ source: { ...SOURCE, intakeId: null }, history: [] }),
      [{ value: "", label: "No linked message" }],
    );
  });

  it("approver quick picks: the requester and the sender, once each, never the current value", () => {
    const todo = {
      requester: { name: "Pat Sample", email: "pat.sample@deloitte.com" },
      source: { ...SOURCE, sender: "Pat Sample" },
    };
    assert.deepEqual(approverSuggestions(todo, ""), [
      "Pat Sample (pat.sample@deloitte.com)",
      "Pat Sample",
    ]);
    assert.deepEqual(approverSuggestions(todo, "pat sample"), [
      "Pat Sample (pat.sample@deloitte.com)",
    ]);
    assert.deepEqual(
      approverSuggestions(
        { requester: { name: null, email: null }, source: { ...SOURCE, sender: null } },
        "",
      ),
      [],
    );
  });
});

describe("links and times", () => {
  it("only an https link may be opened; anything else is shown as text", () => {
    assert.equal(
      safeHttpsLink("https://teams.microsoft.com/l/message/x/1"),
      "https://teams.microsoft.com/l/message/x/1",
    );
    for (const bad of [
      "javascript:alert(1)",
      "outlook:00000000ABC",
      "http://x.example",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      assert.equal(safeHttpsLink(bad), null, String(bad));
    }
  });

  it("stamp times read in IST", () => {
    assert.equal(stampTime("2026-10-27T05:00:00.000Z"), "27 Oct 2026, 10:30 IST");
    assert.equal(stampTime("garbage"), "garbage");
  });
});

describe("the list row", () => {
  it("shows a badge while a sign-off is pending, overdue, on conditions or sent back", () => {
    const awaiting = requested();
    const soon = signoffRowView(awaiting, ist("2026-10-27T11:00"), prefs);
    assert.equal(soon.text, "Awaiting sign-off from Jordan Sample for 1 day");
    assert.equal(signoffBadgeText(soon), "Sign-off pending");
    assert.equal(soon.overdue, false);
    const late = signoffRowView(awaiting, ist("2026-10-29T11:00"), prefs);
    assert.equal(late.overdue, true);
    assert.equal(signoffBadgeText(late), "Sign-off overdue");
    assert.equal(late.tone, "accent", "never a second strong chip on a row");

    const conditions = signoffRowView(
      must(
        recordSignoff(awaiting, {
          outcome: "approved_with_conditions",
          conditions: "Add the risk table",
          evidence: EVIDENCE,
          now: T1,
          by: "a",
        }),
      ),
      ist("2026-10-27T11:00"),
      prefs,
    );
    assert.equal(signoffBadgeText(conditions), "Conditions");
    const sentBack = signoffRowView(
      must(
        recordSignoff(awaiting, {
          outcome: "rejected",
          evidence: EVIDENCE,
          now: T1,
          by: "a",
        }),
      ),
      ist("2026-10-27T11:00"),
      prefs,
    );
    assert.equal(sentBack.text, "Rejected from Jordan Sample");
    assert.equal(signoffBadgeText(sentBack), "Rejected");
  });

  it("shows nothing before a request, after approval, on a closed to-do or without a sign-off step", () => {
    const now = ist("2026-10-27T11:00");
    assert.equal(signoffRowView(fresh(), now, prefs), null);
    assert.equal(
      signoffRowView(
        must(
          recordSignoff(requested(), {
            outcome: "approved",
            evidence: EVIDENCE,
            now: T1,
            by: "a",
          }),
        ),
        now,
        prefs,
      ),
      null,
    );
    assert.equal(signoffRowView({ ...requested(), status: "done" }, now, prefs), null);
    const simple = buildTodo(emptyDraft("x"), {
      now: T0,
      approvedBy: "t",
      source: SOURCE,
    });
    assert.equal(signoffRowView(simple, now, prefs), null);
  });
});

describe("the components", () => {
  const read = (name) => readFileSync(path.join(here, name), "utf8");

  it("a sign-off step cannot be ticked 'Done' from the checkpoint row, and a stamped one cannot be reopened or removed there", () => {
    const editors = read("TodoEditors.tsx");
    assert.match(editors, /\{!isSignoff && \(/);
    assert.match(editors, /!stamped && \(/);
    assert.match(editors, /disabled=\{busy \|\| stamped\}/);
    assert.match(editors, /<SignoffPanel/);
  });

  it("the stamp is shown as text and the evidence link opens only when it is https", () => {
    const panelSource = read("SignoffPanel.tsx");
    assert.match(panelSource, /\{stamp\.label\}/);
    assert.match(panelSource, /recorded by \{stamp\.recordedBy\}/);
    assert.match(panelSource, /stamp\.evidenceLink && \(/);
    assert.ok(!/dangerouslySetInnerHTML/.test(panelSource));
  });

  it("the request dialog's one state-changing button is 'Mark as requested'", () => {
    const dialog = read("SignoffRequestDialog.tsx");
    assert.match(dialog, /Mark as requested/);
    assert.equal((dialog.match(/requestSignoff\(/g) ?? []).length, 1);
    assert.match(dialog, /Improve with AI/);
    // The model's text goes into a textarea or plain text, never HTML.
    assert.ok(!/dangerouslySetInnerHTML/.test(dialog));
  });

  it("the review card shows the reading, the quote and the reasoning, and never pre-ticks on its own", () => {
    const card = read("UpdateCard.tsx");
    assert.match(card, /Model&apos;s reading|Model's reading/);
    assert.match(card, /Reasoning:/);
    assert.match(card, /Sign-off reply/);
    assert.match(card, /isOn\(change\.id, change\.defaultOn\)/);
  });
});
