import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confirmCopy,
  fileName,
  isMailTask,
  needsConfirm,
  REJECT_NOTE,
  RESET_NOTE,
  SEND_NOTE,
} from "./confirmCopy.ts";

function task(overrides = {}) {
  return {
    id: "deployment-dep-weekend-mailer",
    displayName: "Deployment Weekend Mailer",
    state: "awaiting_send",
    error: null,
    currentStep: "send",
    steps: [{ id: "send", type: "confirm" }],
    notifications: [],
    ...overrides,
  };
}

describe("confirmCopy", () => {
  it("send echoes task, notice and output file names plus the Outlook note", () => {
    const copy = confirmCopy(
      "send",
      task({
        notifications: [
          {
            id: "n1",
            kind: "task.review_ready",
            title: "Ready",
            body: "Draft email for 14 Nov is ready.",
            outputPath: "C:\\x\\output\\email-data.json",
            createdAt: "2026-10-28T00:00:00Z",
          },
        ],
      }),
    );
    assert.ok(copy);
    assert.equal(copy.body, SEND_NOTE);
    assert.equal(copy.confirmLabel, "Confirm & send");
    assert.equal(copy.destructive, true);
    assert.equal(copy.showsDraft, true);
    assert.deepEqual(copy.details, [
      "Task: Deployment Weekend Mailer",
      "Draft email for 14 Nov is ready.",
      "Output: email-data.json",
    ]);
  });

  it("send uses the step label as the confirm label and tolerates no notice", () => {
    const copy = confirmCopy(
      "send",
      task({ steps: [{ id: "send", type: "confirm", label: "Send mail" }] }),
    );
    assert.equal(copy.confirmLabel, "Send mail");
    assert.deepEqual(copy.details, ["Task: Deployment Weekend Mailer"]);
  });

  it("send for a non-mail task makes no Outlook claim", () => {
    const copy = confirmCopy(
      "send",
      task({ id: "shift-roster", displayName: "Shift Roster", steps: [] }),
    );
    assert.equal(copy.body, "This cannot be undone.");
    assert.equal(copy.showsDraft, false);
  });

  it("reject explains the leftover draft for a mail task", () => {
    const copy = confirmCopy("reject", task({ state: "awaiting_review" }));
    assert.equal(copy.body, REJECT_NOTE);
    assert.equal(copy.confirmLabel, "Reject");
    assert.equal(copy.showsDraft, false);
  });

  it("reject for a non-mail task does not mention Outlook", () => {
    const copy = confirmCopy(
      "reject",
      task({ id: "monthly-report-deck", displayName: "Monthly Report", steps: [] }),
    );
    assert.doesNotMatch(copy.body, /Outlook/);
  });

  it("force reset confirms only while a run is in progress", () => {
    for (const state of ["working", "finishing"]) {
      const copy = confirmCopy("reset", task({ state }));
      assert.equal(copy.body, RESET_NOTE);
      assert.equal(copy.confirmLabel, "Force reset");
      assert.equal(copy.destructive, true);
    }
    for (const state of ["error", "resting", "awaiting_send"]) {
      assert.equal(confirmCopy("reset", task({ state })), null);
      assert.equal(needsConfirm("reset", task({ state })), false);
    }
  });
});

describe("helpers", () => {
  it("fileName handles both separators", () => {
    assert.equal(fileName("C:\\a\\b\\c.json"), "c.json");
    assert.equal(fileName("/a/b/c.json"), "c.json");
  });

  it("isMailTask looks at id, name, steps and notices", () => {
    assert.equal(isMailTask(task()), true);
    assert.equal(
      isMailTask(task({ id: "x", displayName: "X", steps: [], notifications: [] })),
      false,
    );
    assert.equal(
      isMailTask(
        task({
          id: "x",
          displayName: "X",
          steps: [{ id: "draft_outlook", type: "powershell" }],
        }),
      ),
      true,
    );
  });
});
