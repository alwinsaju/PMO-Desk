// Runs the PMO structuring test set against a real local model through the app's own
// prompt, schema, Ollama client and sanitiser (no stub). Test tooling only.
//   node run-eval.mjs <model> [label] [caseIdPrefix ...]
// Writes results-<label>.json next to this file and prints a scorecard.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const src = (p) => import(pathToFileURL(path.join(root, "src", p)).href);

const { createOllamaClient, FifoQueue, loadAiRuntimeConfig } = await src("lib/ai-runtime/core.ts");
const { AiModelTasksSchema, AiStructuredSchema } = await src("lib/pmo/types.ts");
const { buildSystemPrompt, buildUserPrompt } = await src("lib/pmo/structurePrompt.ts");
const { prepareForModelDetailed, displayText } = await src("lib/pmo/preprocess.ts");
const { groundQuote } = await src("lib/pmo/quote.ts");
const { sanitizeDraft } = await src("lib/pmo/sanitizeDraft.ts");
const { asTaskList } = await src("lib/pmo/splitTasks.ts");
const { CASES, ME, NOW, TIME_ZONE } = await import(pathToFileURL(path.join(here, "cases.mjs")).href);

const [model, label = model.replace(/[^\w.-]/g, "_"), ...only] = process.argv.slice(2);
if (!model) throw new Error("usage: node run-eval.mjs <model> [label] [caseIdPrefix ...]");

const config = loadAiRuntimeConfig({ ...process.env, AI_OS_AI_AUTOSTART: "0" });
const client = createOllamaClient({ config, fetch, queue: new FifoQueue() });
const SCHEMA = AiModelTasksSchema.transform(({ tasks }) => tasks.map((t) => AiStructuredSchema.parse(t)));

function check(expect, task, text, intake) {
  const c = {};
  const want = (key, ok) => {
    if (expect[key] !== undefined) c[key] = !!ok;
  };
  want("isMe", expect.isMe ? task.owner.isMe === true : task.owner.isMe !== true);
  want("dueAt", task.dueAt === expect.dueAt);
  want("priority", Array.isArray(expect.priority) ? expect.priority.includes(task.priority) : task.priority === expect.priority);
  want("title", expect.title?.test(task.title));
  want("recurrence", expect.recurrence ? !!task.recurrence : !task.recurrence);
  want("requesterEmail", (task.requester.email ?? "").toLowerCase() === expect.requesterEmail);
  want("notOwner", !expect.notOwner?.test(`${task.owner.name ?? ""} ${task.owner.email ?? ""} ${task.title}`));
  c.quote = groundQuote(text, task.quote).verified;
  return c;
}

const results = [];
for (const testCase of CASES) {
  if (only.length && !only.some((p) => testCase.id.startsWith(p))) continue;
  const { intake, expect } = testCase;
  const system = buildSystemPrompt(ME, TIME_ZONE);
  const body = prepareForModelDetailed(intake).text;
  const prompt = buildUserPrompt(intake, body, NOW, TIME_ZONE);
  const started = Date.now();
  let output = null;
  let error = null;
  try {
    output = await client.generateJson({ system, prompt, schema: SCHEMA, model, timeoutMs: 280_000, think: false });
  } catch (e) {
    error = `${e?.code ?? ""} ${e?.message ?? e}`.trim();
  }
  const durationMs = Date.now() - started;
  const row = { id: testCase.id, durationMs, error, checks: {}, rawChecks: {}, tasks: 0 };
  if (output) {
    const tasks = asTaskList(output);
    const actionable = tasks.filter((t) => t.isActionable);
    row.tasks = actionable.length;
    row.actionable = { ok: expect.actionable ? actionable.length > 0 : actionable.length === 0 };
    if (expect.actionable && expect.tasks) {
      row.count = { ok: actionable.length >= expect.tasks[0] && actionable.length <= expect.tasks[1] };
    }
    const primary = actionable[0];
    if (expect.actionable && primary) {
      const text = displayText(intake);
      const grounded = groundQuote(text, primary.quote);
      const sanitized = sanitizeDraft({ ...primary, quote: grounded.quote }, {
        now: NOW, timeZone: TIME_ZONE, text: `${intake.subject}\n${body}`, me: ME,
        subject: intake.subject, bodyText: body, sender: { name: intake.sender.name, address: intake.sender.address },
      });
      row.rawChecks = check(expect, primary, text, intake);
      row.checks = check(expect, sanitized.draft, text, intake);
      row.fallback = sanitized.fallback;
      row.adjustments = sanitized.adjustments;
      row.draft = { title: sanitized.draft.title, owner: sanitized.draft.owner, requester: sanitized.draft.requester, dueAt: sanitized.draft.dueAt, priority: sanitized.draft.priority, waitingOn: sanitized.draft.waitingOn, recurrence: sanitized.draft.recurrence, actionItems: sanitized.draft.actionItems.length };
      row.raw = { title: primary.title, isMe: primary.owner.isMe, dueAt: primary.dueAt, priority: primary.priority };
    }
    row.output = output;
  }
  results.push(row);
  const bad = Object.entries({ actionable: row.actionable?.ok, count: row.count?.ok, ...row.checks }).filter(([, v]) => v === false).map(([k]) => k);
  console.log(`${testCase.id.padEnd(38)} ${(durationMs / 1000).toFixed(1).padStart(6)}s  ${error ? "ERROR " + error : bad.length ? "FAIL: " + bad.join(",") : "ok"}`);
}

const tally = {};
const add = (k, v) => { if (v === undefined) return; (tally[k] ??= [0, 0])[v ? 0 : 1]++; };
for (const r of results) {
  add("actionable", r.error ? false : r.actionable?.ok);
  add("count", r.count?.ok);
  for (const [k, v] of Object.entries(r.checks)) add(k, v);
}
const summary = Object.fromEntries(Object.entries(tally).map(([k, [p, f]]) => [k, `${p}/${p + f}`]));
const total = Object.values(tally).reduce((a, [p, f]) => [a[0] + p, a[1] + f], [0, 0]);
const out = { model, label, when: new Date().toISOString(), summary, pct: Math.round((100 * total[0]) / (total[0] + total[1])), medianSeconds: [...results.map((r) => r.durationMs)].sort((a, b) => a - b)[Math.floor(results.length / 2)] / 1000, results };
fs.writeFileSync(path.join(here, `results-${label}.json`), JSON.stringify(out, null, 2));
console.log("\nsummary", JSON.stringify(summary), `overall ${out.pct}%`, `median ${out.medianSeconds}s`);
