// Run with `pnpm test`. The Reports tab's view-model (pure; no React): the period
// choice, the draft and what counts as edited or unsaved, the save request, the
// highlights card, the copy texts, the mail link and the previous-reports rows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown } from "../../../lib/pmo/report.ts";
import { build, sampleTodos, SAT } from "../../../lib/pmo/reportFixtures.mjs";
import {
  PERIOD_CHOICES,
  addNarrative,
  copyText,
  draftFromGenerated,
  draftFromSaved,
  draftSubtitle,
  hasUnsavedEdits,
  initialReportView,
  isEdited,
  isUnsaved,
  mailLink,
  markSaved,
  narrativeView,
  periodRequest,
  saveBody,
  saveState,
  savedRows,
  summaryChips,
} from "./reportView.ts";

const TZ = "Asia/Kolkata";
const data = build(sampleTodos());
const generated = () =>
  draftFromGenerated({
    id: "rp_0123456789abcdef",
    data,
    markdown: renderMarkdown(data),
    capped: false,
  });

const job = (patch = {}) => ({
  id: "rn_0123456789abcdef",
  key: "2026-10-19_2026-10-24",
  status: "ready",
  startedAt: "2026-10-24T06:31:00.000Z",
  finishedAt: "2026-10-24T06:32:00.000Z",
  narrative: {
    highlights: ['Closed "Publish RAID log v3".'],
    risks: ["Nothing to report."],
    nextWeek: [],
  },
  removed: [],
  error: null,
  model: "gemma4:12b",
  promptVersion: 1,
  ...patch,
});

describe("the period", () => {
  it("offers this week, last week, last 7 days and a custom range", () => {
    assert.deepEqual(
      PERIOD_CHOICES.map((c) => c.id),
      ["this-week", "last-week", "last-7-days", "custom"],
    );
    const view = initialReportView("2026-10-24");
    assert.deepEqual(
      [view.choice, view.customStart, view.customEnd, view.draft],
      ["this-week", "2026-10-18", "2026-10-24", null],
    );
    assert.equal(initialReportView("2026-03-02").customStart, "2026-02-24");
  });

  it("turns a pick into a request and checks a custom range the way the server does", () => {
    const pick = (choice, customStart = "", customEnd = "") =>
      periodRequest({ choice, customStart, customEnd }, SAT, TZ);
    assert.deepEqual(pick("last-week").request, { kind: "last-week" });
    assert.deepEqual(pick("custom", "2026-10-01", "2026-10-10").request, {
      kind: "custom",
      start: "2026-10-01",
      end: "2026-10-10",
    });
    assert.match(pick("custom", "", "2026-10-10").reason, /start and an end/);
    assert.match(pick("custom", "2026-10-10", "2026-10-01").reason, /after the end/);
    assert.match(pick("custom", "2026-10-10", "2026-12-01").reason, /future/);
    assert.match(pick("custom", "2026-01-01", "2026-10-01").reason, /at most 92/);
    assert.match(pick("custom", "garbage", "2026-10-01").reason, /start and an end/);
  });
});

describe("the draft", () => {
  it("a fresh report is unedited, unsaved and saveable; the subtitle and chips describe it", () => {
    const draft = generated();
    assert.equal(draft.text, draft.baseline);
    assert.equal(isEdited(draft), false);
    assert.equal(isUnsaved(draft), true);
    assert.equal(hasUnsavedEdits(draft), false, "nothing worth a warning yet");
    assert.deepEqual(saveState(draft), { label: "Not saved yet", canSave: true });
    assert.equal(
      draftSubtitle(draft),
      "Mon 19 Oct to Sat 24 Oct 2026. Open items are as of Sat 24 Oct 2026.",
    );
    assert.deepEqual(summaryChips(draft.summary), [
      { label: "5 open", strong: false },
      { label: "2 closed", strong: false },
      { label: "2 new", strong: false },
      { label: "1 overdue", strong: true },
      { label: "1 waiting", strong: false },
    ]);
    assert.deepEqual(summaryChips(null), []);
    assert.equal(
      summaryChips({ ...data.summary, overdue: 0, waiting: 0 }).some((c) => c.strong),
      false,
    );
  });

  it("editing marks it edited and unsaved; the first save sends the resolved days, no base revision", () => {
    const draft = { ...generated(), text: "# My version\n" };
    assert.equal(isEdited(draft), true);
    assert.equal(hasUnsavedEdits(draft), true);
    assert.deepEqual(saveBody(draft), {
      markdown: "# My version\n",
      edited: true,
      period: { start: "2026-10-19", end: "2026-10-24", kind: "this-week" },
      generatedAt: data.generatedAt,
      narrative: null,
    });
    assert.equal(saveBody(generated()).edited, false);
  });

  it("after a save it is clean; a further edit is an unsaved change on top of that revision", () => {
    const saved = markSaved({ ...generated(), text: "# v1\n" }, 1, "# v1\n");
    assert.deepEqual(saveState(saved), { label: "Saved as revision 1", canSave: false });
    assert.equal(hasUnsavedEdits(saved), false);
    const again = { ...saved, text: "# v2\n" };
    assert.deepEqual(saveState(again), {
      label: "Unsaved changes (saved: revision 1)",
      canSave: true,
    });
    assert.equal(saveBody(again).baseRevision, 1);
    assert.equal(hasUnsavedEdits(again), true);
    // Going back to the saved text is clean again.
    assert.equal(hasUnsavedEdits({ ...again, text: "# v1\n" }), false);
  });

  it("an empty editor cannot be saved", () => {
    assert.equal(saveState({ ...generated(), text: "  \n" }).canSave, false);
    assert.equal(
      saveState({ ...markSaved(generated(), 1, "x"), text: "" }).canSave,
      false,
    );
  });

  it("a reopened report starts from the saved text, remembers if it was an edit, and warns only for new edits", () => {
    const opened = {
      summary: {
        id: "rp_00000000cafe0001",
        title: "Atlas: Weekly status",
        period: {
          kind: "last-week",
          startDay: "2026-10-12",
          endDay: "2026-10-18",
          label: "Mon 12 Oct to Sun 18 Oct 2026",
        },
        generatedAt: "2026-10-19T04:00:00.000Z",
        savedAt: "2026-10-19T05:00:00.000Z",
        revisions: 2,
        edited: true,
        usedModel: true,
      },
      revision: 2,
      markdown: "# Saved text\n",
      revisions: [
        { rev: 1, savedAt: "x", savedBy: "u", edited: false },
        { rev: 2, savedAt: "y", savedBy: "u", edited: true },
      ],
      data: { asOfDay: "2026-10-19", summary: data.summary },
    };
    const draft = draftFromSaved(opened);
    assert.equal(draft.id, "rp_00000000cafe0001");
    assert.equal(draft.text, "# Saved text\n");
    assert.equal(draft.savedRevision, 2);
    assert.equal(isEdited(draft), true, "revision 2 was itself an edit");
    assert.equal(hasUnsavedEdits(draft), false);
    assert.equal(draft.summary.open, 5);
    assert.equal(draft.asOfDay, "2026-10-19");
    assert.equal(saveBody({ ...draft, text: "# More\n" }).baseRevision, 2);
    assert.equal(hasUnsavedEdits({ ...draft, text: "# More\n" }), true);
    // A sidecar without usable data still opens.
    const bare = draftFromSaved({
      ...opened,
      data: null,
      revisions: [],
      summary: { ...opened.summary, edited: false },
    });
    assert.equal(bare.summary, null);
    assert.equal(bare.asOfDay, "2026-10-18");
    assert.equal(isEdited(bare), false);
  });
});

describe("the highlights card", () => {
  it("is idle with no job, says drafting can take a minute, and shows a failure with its message", () => {
    assert.deepEqual(narrativeView(null, generated()), { kind: "idle" });
    const drafting = narrativeView(
      job({ status: "drafting", narrative: null }),
      generated(),
    );
    assert.equal(drafting.kind, "drafting");
    assert.match(drafting.text, /can take a minute on this PC/);
    assert.match(drafting.text, /complete without it/);
    const failed = narrativeView(
      job({
        status: "failed",
        narrative: null,
        error: "The local model took too long to answer.",
      }),
      generated(),
    );
    assert.deepEqual(failed, {
      kind: "failed",
      message: "The local model took too long to answer.",
    });
    assert.equal(
      narrativeView(job({ status: "failed", narrative: null, error: null }), null).message
        .length > 5,
      true,
    );
  });

  it("shows the verified lines by part, a note about what was left out, and whether it is already in the text", () => {
    const view = narrativeView(job(), generated());
    assert.equal(view.kind, "ready");
    assert.deepEqual(view.parts, [
      { heading: "Highlights", lines: ['Closed "Publish RAID log v3".'] },
      { heading: "Risks / blockers", lines: ["Nothing to report."] },
    ]);
    assert.equal(view.removedNote, null);
    assert.equal(view.applied, false);
    assert.equal(view.model, "gemma4:12b");
    const one = narrativeView(
      job({
        removed: [
          { part: "Highlights", line: "Rahul did x", reason: "Rahul is not a name" },
        ],
      }),
      generated(),
    );
    assert.equal(
      one.removedNote,
      "1 line was left out because it names something that is not in your to-dos.",
    );
    const two = narrativeView(
      job({
        removed: [
          { part: "a", line: "b", reason: "c" },
          { part: "d", line: "e", reason: "f" },
        ],
      }),
      generated(),
    );
    assert.match(two.removedNote, /^2 lines were left out because they name something/);
    assert.equal(
      narrativeView(job(), { narrativeJobId: "rn_0123456789abcdef" }).applied,
      true,
    );
  });

  it("adding the highlights keeps the report unedited, keeps hand edits, and replaces an earlier version", () => {
    const added = addNarrative(generated(), job());
    assert.ok(added.text.includes('## Highlights\n- Closed "Publish RAID log v3".'));
    assert.equal(isEdited(added), false, "the baseline got the same insertion");
    assert.deepEqual(added.narrative, { model: "gemma4:12b", promptVersion: 1 });
    assert.equal(added.narrativeJobId, "rn_0123456789abcdef");
    assert.equal(saveBody(added).narrative.model, "gemma4:12b");
    assert.equal(added.text, renderMarkdown(data, { narrative: job().narrative }));

    const edited = {
      ...added,
      text: added.text.replace("- Open: 5", "- Open: 5 (by hand)"),
    };
    const second = addNarrative(
      edited,
      job({
        id: "rn_second",
        narrative: { highlights: ["Second go."], risks: [], nextWeek: [] },
      }),
    );
    assert.ok(second.text.includes("(by hand)"));
    assert.equal((second.text.match(/## Highlights/g) ?? []).length, 1);
    assert.ok(second.text.includes("- Second go."));
    assert.ok(!second.text.includes('Publish RAID log v3".'));
    assert.equal(isEdited(second), true);

    const notReady = addNarrative(
      generated(),
      job({ status: "drafting", narrative: null }),
    );
    assert.equal(notReady.text, generated().text);
  });
});

describe("copy and mail", () => {
  it("Copy as Markdown is the editor text; Copy as text is the plain version for Outlook and Teams", () => {
    const draft = {
      ...generated(),
      text: "# Status\n\n## Summary\n- Open: **3** and \\*not bold\\*\n- See [plan](https://example.com)\n",
    };
    assert.equal(copyText(draft, "markdown"), draft.text);
    assert.equal(
      copyText(draft, "text"),
      "Status\n\nSummary\n• Open: 3 and *not bold*\n• See plan (https://example.com)\n",
    );
    // What the person edits is what gets copied.
    assert.ok(copyText({ ...draft, text: "# Mine\n" }, "text").startsWith("Mine"));
  });

  it("offers an unsent mail draft only while the text fits in a link", () => {
    const short = {
      ...generated(),
      text: "# Status\n\n- Open: 3\n- Closed this period: 1\n",
    };
    const link = mailLink(short);
    assert.equal(link.ok, true);
    assert.ok(link.url.startsWith("mailto:?subject="));
    assert.ok(
      link.url.includes(
        encodeURIComponent("Weekly status: Mon 19 Oct to Sat 24 Oct 2026"),
      ),
    );
    assert.ok(
      link.url.includes(encodeURIComponent("\r\n")),
      "CRLF line breaks for mail clients",
    );
    assert.ok(!link.url.includes("%2A%2A"), "the plain text has no Markdown");

    const full = mailLink(generated());
    assert.equal(full.ok, false, "a real report is too long for a mail link");
    assert.match(full.reason, /Too long for a mail link/);
    assert.match(full.reason, /Use Copy/);
    assert.equal(mailLink({ ...generated(), text: "x".repeat(3000) }).ok, false);
  });
});

describe("previous reports", () => {
  it("rows say what, when, how many revisions, and whether it was edited or used the model", () => {
    const rows = savedRows(
      [
        {
          id: "rp_1",
          title: "Weekly status",
          period: {
            kind: "this-week",
            startDay: "2026-10-19",
            endDay: "2026-10-24",
            label: "Mon 19 Oct to Sat 24 Oct 2026",
          },
          generatedAt: "2026-10-24T06:30:00.000Z",
          savedAt: "2026-10-24T08:32:00.000Z",
          revisions: 3,
          edited: true,
          usedModel: true,
        },
        {
          id: "rp_2",
          title: "Weekly status",
          period: {
            kind: "last-week",
            startDay: "2026-10-12",
            endDay: "2026-10-18",
            label: "Mon 12 Oct to Sun 18 Oct 2026",
          },
          generatedAt: "2026-10-19T06:30:00.000Z",
          savedAt: "2026-10-19T06:35:00.000Z",
          revisions: 1,
          edited: false,
          usedModel: false,
        },
      ],
      TZ,
    );
    assert.equal(rows[0].periodLabel, "Mon 19 Oct to Sat 24 Oct 2026");
    assert.match(rows[0].savedLabel, /Sat,? 24 Oct, 14:02/);
    assert.equal(rows[0].revisionLabel, "3 revisions");
    assert.deepEqual(rows[0].chips, ["edited", "AI highlights"]);
    assert.equal(rows[1].revisionLabel, "1 revision");
    assert.deepEqual(rows[1].chips, []);
    assert.deepEqual(savedRows([], TZ), []);
  });
});
