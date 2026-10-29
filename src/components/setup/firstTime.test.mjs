// Run with `pnpm test`. The first-time setup page: how each step is judged, and that the
// Power Automate guides show exactly what the app can read.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProfileFile } from "../../lib/staff/exchange.ts";
import { readPtoFile } from "../../lib/staff/ptoMail.ts";
import { IntakeSchema } from "../../lib/pmo/types.ts";
import { GUIDES, PMO_COMPOSE, PTO_COMPOSE, STAFF_COMPOSE } from "./flowGuides.ts";
import {
  STEPS,
  firstOpenStep,
  outcomes,
  shouldAutoAdvance,
  stepPhase,
} from "./firstTimeSteps.ts";

const step = (id) => STEPS.find((s) => s.id === id);
const check = (id, state, extra = {}) => ({
  id,
  title: id,
  required: true,
  state,
  summary: "",
  steps: [],
  details: [],
  actions: [],
  ...extra,
});
const report = (checks) => ({ checks, ready: true, generatedAt: "" });
const idle = { install: { running: false }, pull: { running: false } };

describe("first-time steps", () => {
  it("go from the local AI to the finish, one thing at a time", () => {
    assert.deepEqual(
      STEPS.map((s) => s.id),
      ["welcome", "ollama", "model", "engine", "outlook", "folders", "flows", "finish"],
    );
    assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
  });

  it("wait for the first answer, and treat Ollama installed-but-stopped as fine", () => {
    assert.equal(stepPhase(step("ollama"), null, null), "checking");
    assert.equal(
      stepPhase(step("ollama"), report([check("ollama", "attention")]), idle),
      "done",
    );
    assert.equal(
      stepPhase(step("ollama"), report([check("ollama", "ok")]), idle),
      "done",
    );
    assert.equal(
      stepPhase(
        step("ollama"),
        report([check("ollama", "missing", { actions: ["install-ollama"] })]),
        idle,
      ),
      "action",
    );
  });

  it("show a running download or self-test as working", () => {
    const r = report([check("ollama", "missing"), check("model", "missing")]);
    assert.equal(
      stepPhase(step("ollama"), r, { ...idle, install: { running: true } }),
      "working",
    );
    assert.equal(
      stepPhase(step("model"), r, { ...idle, pull: { running: true } }),
      "working",
    );
    const running = report([
      check("engine", "unknown", { summary: "Running the self-test…" }),
    ]);
    assert.equal(stepPhase(step("engine"), running, idle), "working");
    const notRun = report([check("engine", "unknown", { actions: ["run-selftest"] })]);
    assert.equal(stepPhase(step("engine"), notRun, idle), "checking");
  });

  it("ask for a button press when the model is the wrong one or missing", () => {
    const wrong = report([check("model", "attention", { actions: ["pull-model"] })]);
    assert.equal(stepPhase(step("model"), wrong, idle), "action");
    assert.equal(stepPhase(step("model"), report([check("model", "ok")]), idle), "done");
  });

  it("let optional steps stay open without blocking", () => {
    const outlook = report([check("outlook", "attention", { required: false })]);
    assert.equal(stepPhase(step("outlook"), outlook, idle), "attention");
    const folders = report([
      check("folders", "attention", { actions: ["create-folders"] }),
    ]);
    assert.equal(stepPhase(step("folders"), folders, idle), "action");
    assert.equal(
      stepPhase(step("folders"), report([check("folders", "ok")]), idle),
      "done",
    );
  });

  it("do not hold the page up for a check an older server does not have", () => {
    assert.equal(stepPhase(step("folders"), report([]), idle), "done");
  });

  it("leave the welcome, flows and finish steps to the person", () => {
    for (const id of ["welcome", "flows", "finish"]) {
      assert.equal(stepPhase(step(id), report([]), idle), "manual");
      assert.equal(shouldAutoAdvance(step(id), "manual", false), false);
    }
  });

  it("move on by themselves when done, unless the person went back", () => {
    assert.equal(shouldAutoAdvance(step("model"), "done", false), true);
    assert.equal(shouldAutoAdvance(step("model"), "done", true), false);
    assert.equal(shouldAutoAdvance(step("model"), "action", false), false);
  });

  it("start at the first thing still open", () => {
    const r = report([
      check("ollama", "ok"),
      check("model", "missing"),
      check("engine", "ok"),
    ]);
    assert.equal(firstOpenStep(r, idle), "model");
    const all = report([
      check("ollama", "ok"),
      check("model", "ok"),
      check("engine", "ok"),
      check("outlook", "ok"),
      check("folders", "ok"),
    ]);
    assert.equal(firstOpenStep(all, idle), "flows");
  });

  it("sum up how each step ended", () => {
    const r = report([
      check("ollama", "ok", { summary: "Ollama is installed." }),
      check("model", "missing", { summary: "No model." }),
      check("engine", "ok"),
      check("outlook", "attention"),
      check("folders", "ok"),
      check("flows", "unknown"),
    ]);
    const out = Object.fromEntries(
      outcomes(r, idle, new Set(["outlook"])).map((o) => [o.step.id, o.outcome]),
    );
    assert.deepEqual(out, {
      ollama: "ok",
      model: "open",
      engine: "ok",
      outlook: "skipped",
      folders: "ok",
      flows: "open",
    });
  });
});

// Tokens of a Power Automate Compose, replaced by sample values so the JSON can be read.
const sample = (compose, values = {}) =>
  compose.replace(/"@\{?([^"]*?)\}?"/g, (whole, expr) => {
    for (const [key, value] of Object.entries(values)) {
      if (expr.includes(key)) return JSON.stringify(value);
    }
    return '"sample"';
  });

describe("the Power Automate guides", () => {
  it("have unique ids, a create step first and a save step last", () => {
    assert.deepEqual(
      GUIDES.map((g) => g.id),
      ["pto", "staff", "pmo"],
    );
    for (const guide of GUIDES) {
      assert.equal(
        new Set(guide.steps.map((s) => s.id)).size,
        guide.steps.length,
        guide.id,
      );
      assert.equal(guide.steps[0].id, "create");
      assert.equal(guide.steps.at(-1).id, "save");
      assert.equal(
        guide.steps.filter((s) => s.trigger).length,
        1,
        `${guide.id} has one trigger`,
      );
      for (const s of guide.steps)
        assert.ok(s.doThis.length > 0, `${guide.id}/${s.id} says what to do`);
    }
  });

  it("send every flow's files to a folder inside AI-OS", () => {
    for (const guide of GUIDES) {
      const paths = guide.steps
        .flatMap((s) => s.fields)
        .filter((f) => f.value.startsWith("/AI-OS/"));
      assert.ok(paths.length > 0, guide.id);
    }
  });

  it("write a PTO email file the app reads", () => {
    const text = sample(PTO_COMPOSE, {
      "body/id": "AAMk-1",
      receivedDateTime: "2026-10-28T09:00:00Z",
      "body/from": "Ann Jones <p1@x.com>",
      isHtml: false,
    });
    const read = readPtoFile(text);
    assert.equal(read.ok, true, read.reason);
    assert.equal(read.message.sourceId, "AAMk-1");
    assert.equal(read.message.senderAddress, "p1@x.com");
  });

  it("write a profile file the app reads", () => {
    const text = sample(STAFF_COMPOSE, {
      "outputs('Email')": "jane@x.com",
      givenName: "Jane",
    });
    const parsed = parseProfileFile(text);
    assert.equal(parsed.ok, true, parsed.reason);
    assert.equal(parsed.profile.email, "jane@x.com");
    assert.equal(parsed.profile.op, "sample");
  });

  it("write a PMO intake the app reads", () => {
    const text = sample(PMO_COMPOSE.replace(/"@union\([^"]*\)"/, "[]"), {
      "body/id": "AAMk-2",
      receivedDateTime: "2026-10-28T09:00:00Z",
      "if(equals": "text",
    });
    const parsed = IntakeSchema.safeParse(JSON.parse(text));
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });

  it("never start a pasted body with a stray word, which makes unreadable files", () => {
    for (const body of [PTO_COMPOSE, STAFF_COMPOSE, PMO_COMPOSE])
      assert.ok(body.startsWith("{"));
  });
});
