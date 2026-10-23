// Regression: the REAL GET /tasks shape (captured read-only from the live
// backend) must make Run open the start form for tasks that declare inputs.
// Runs against a FAKE fetch only.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as api from "./api.ts";
import { hasStartForm } from "./taskPresenter.ts";
import {
  canPrepare,
  defaultChoice,
  fileInputs,
  missingRequired,
  prepareAfterIds,
  selectChoices,
  selectInputs,
} from "./startForm.ts";

const LIVE_TASKS = [
  {
    "id": "december-disconnect",
    "displayName": "December Disconnect",
    "state": "resting",
    "error": null,
    "currentStep": null,
    "assignedAgentId": null,
    "steps": [
      {
        "id": "analyze",
        "type": "python",
        "label": "Check the rosters and list the questions",
        "gate": null
      },
      {
        "id": "answers",
        "type": "review",
        "label": "Answer the questions",
        "gate": {
          "type": "form",
          "schema": "output/ask-me.json",
          "answers": "output/ask-me-answers.json"
        }
      },
      {
        "id": "build_draft",
        "type": "python",
        "label": "Build the draft winter plans",
        "gate": null
      },
      {
        "id": "review_draft",
        "type": "review",
        "label": "Review the drafts in Excel",
        "gate": {
          "type": "flags",
          "file": "output/flags.json"
        }
      },
      {
        "id": "diff_draft",
        "type": "python",
        "label": "Compare your edits with the drafts",
        "gate": null
      },
      {
        "id": "confirm_diff",
        "type": "confirm",
        "label": "Confirm the changes",
        "gate": {
          "type": "diff",
          "file": "output/roster-diff.json"
        }
      },
      {
        "id": "finalize",
        "type": "python",
        "label": "Build the final winter plans",
        "gate": null
      }
    ],
    "notifications": [],
    "schedule": null,
    "runtime": "local",
    "inputs": [
      {
        "id": "roster",
        "label": "Shift roster workbook",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/roster.xlsx",
        "required": true
      },
      {
        "id": "staff",
        "label": "PDT staff roster workbook",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/staff-roster.xlsx",
        "required": true
      },
      {
        "id": "analytics_a",
        "label": "Analytics roster, first month (optional)",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/analytics-a.xlsx",
        "required": false
      },
      {
        "id": "analytics_b",
        "label": "Analytics roster, second month (optional)",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/analytics-b.xlsx",
        "required": false
      },
      {
        "id": "window",
        "label": "Disconnect window",
        "type": "select",
        "optionsFile": "output/options.json",
        "optionsKey": "windows",
        "required": true
      }
    ],
    "prepare": true
  },
  {
    "id": "monthly-report-deck",
    "displayName": "Monthly Report deck",
    "state": "resting",
    "error": null,
    "currentStep": null,
    "assignedAgentId": null,
    "steps": [
      {
        "id": "prepare_data",
        "type": "python",
        "label": null,
        "gate": null
      },
      {
        "id": "review_incidents",
        "type": "review",
        "label": null,
        "gate": null
      },
      {
        "id": "refresh_workbook",
        "type": "powershell",
        "label": null,
        "gate": null
      },
      {
        "id": "review_workbook",
        "type": "review",
        "label": null,
        "gate": null
      }
    ],
    "notifications": [],
    "schedule": null,
    "runtime": null,
    "inputs": [],
    "prepare": false
  },
  {
    "id": "shift-roster",
    "displayName": "Shift Roster",
    "state": "resting",
    "error": null,
    "currentStep": null,
    "assignedAgentId": null,
    "steps": [
      {
        "id": "analyze",
        "type": "python",
        "label": "Check the roster and list the questions",
        "gate": null
      },
      {
        "id": "answers",
        "type": "review",
        "label": "Answer the questions",
        "gate": {
          "type": "form",
          "schema": "output/ask-me.json",
          "answers": "output/ask-me-answers.json"
        }
      },
      {
        "id": "build_draft",
        "type": "python",
        "label": "Build the draft roster",
        "gate": null
      },
      {
        "id": "review_draft",
        "type": "review",
        "label": "Review the draft in Excel",
        "gate": {
          "type": "flags",
          "file": "output/flags.json"
        }
      },
      {
        "id": "diff_draft",
        "type": "python",
        "label": "Compare your edits with the draft",
        "gate": null
      },
      {
        "id": "confirm_diff",
        "type": "confirm",
        "label": "Confirm the changes",
        "gate": {
          "type": "diff",
          "file": "output/roster-diff.json"
        }
      },
      {
        "id": "finalize",
        "type": "python",
        "label": "Build the final roster",
        "gate": null
      }
    ],
    "notifications": [],
    "schedule": null,
    "runtime": "local",
    "inputs": [
      {
        "id": "roster",
        "label": "Roster workbook",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/roster.xlsx",
        "required": true
      },
      {
        "id": "holidays",
        "label": "Holiday Roster",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/holiday-roster.xlsx",
        "required": true
      },
      {
        "id": "pto",
        "label": "PTO import (optional)",
        "type": "file",
        "accept": [
          ".xlsx"
        ],
        "dest": "input/pto-import.xlsx",
        "required": false
      },
      {
        "id": "cycle",
        "label": "Cycle",
        "type": "select",
        "optionsFile": "output/options.json",
        "optionsKey": "cycles",
        "required": true
      }
    ],
    "prepare": true
  }
];

describe("live /tasks shape", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("keeps inputs/prepare through fetchTasks and opens the start form", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify(LIVE_TASKS), { status: 200 });
    const tasks = await api.fetchTasks();
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    assert.equal(hasStartForm(byId["shift-roster"]), true);
    assert.equal(hasStartForm(byId["december-disconnect"]), true);
    assert.equal(hasStartForm(byId["monthly-report-deck"]), false);
    assert.equal(byId["shift-roster"].prepare, true);
    assert.deepEqual(
      byId["shift-roster"].inputs.map((i) => i.id),
      ["roster", "holidays", "pto", "cycle"],
    );
  });

  for (const [id, after, optional, selectId, key] of [
    ["december-disconnect", ["roster", "staff"], ["analytics_a", "analytics_b"], "window", "windows"],
    ["shift-roster", ["roster", "holidays"], ["pto"], "cycle", "cycles"],
  ]) {
    it(`start form logic works on the live ${id} manifest (files, optional files, select)`, async () => {
      globalThis.fetch = async () => new Response(JSON.stringify(LIVE_TASKS), { status: 200 });
      const task = (await api.fetchTasks()).find((t) => t.id === id);
      // GET /tasks exposes `prepare` as a bool: the "after" list falls back to the required files.
      assert.deepEqual(prepareAfterIds(task), after);
      assert.deepEqual(fileInputs(task).filter((i) => !i.required).map((i) => i.id), optional);
      assert.deepEqual(selectInputs(task).map((i) => i.id), [selectId]);

      const status = (ids) => ids.map((i) => ({ id: i, present: true }));
      assert.equal(canPrepare(task, status(after.slice(0, 1))), false);
      assert.equal(canPrepare(task, status(after)), true);

      const options = { [key]: [{ id: "a", label: "A" }, { id: "b", label: "B", enabled: false, reason: "no data" }], default: "a" };
      const choices = selectChoices(options, key);
      assert.equal(defaultChoice(options, choices), "a");
      const byInput = { [selectId]: choices };
      // Required files and a choice are all that Start needs; optional files never block it.
      assert.equal(missingRequired(task, status(after), { [selectId]: "a" }, byInput).length, 0);
      assert.equal(missingRequired(task, status(after), { [selectId]: "b" }, byInput).length, 1);
      assert.equal(missingRequired(task, [], {}, byInput).length, after.length + 1);
    });
  }
});
