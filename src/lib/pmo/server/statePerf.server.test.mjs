// Run with `pnpm test`. The state the To-Do window polls: with an unchanged data folder the
// answer comes from the store's cache without touching the 1,000 record files, and any
// change (a write here, a file added from outside) shows up at once.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createPmo } from "./create.ts";
import { buildState, buildSummary } from "./state.ts";
import { buildTodo, emptyDraft } from "../todoLogic.ts";

const COUNT = 1000;
const NOW = "2026-11-05T05:00:00.000Z";
const generator = { model: () => "x", generate: async () => ({}) };
const deps = (dataDir) => ({
  runtime: async () => ({ state: "stub", model: "stub", message: null }),
  dataDir,
});
const todoOf = (i) => {
  const draft = emptyDraft(`To-do number ${i} about the vendor contract`);
  draft.description = "Some context for the request. ".repeat(30);
  draft.dueAt = "2026-11-10";
  return buildTodo(draft, {
    now: NOW,
    approvedBy: "me",
    source: {
      intakeId: null,
      source: "manual",
      link: null,
      subject: "",
      sender: null,
      receivedAt: null,
      threadKey: null,
    },
  });
};
const timed = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
};

describe(`state with ${COUNT} to-dos`, () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "pmo-state-perf-"));
    const pmo = await createPmo({ dataDir: dir, generator });
    for (let i = 0; i < COUNT; i++) await pmo.store.putTodo(todoOf(i));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("an unchanged poll is more than 10x faster than the first one", async () => {
    const pmo = await createPmo({ dataDir: dir, generator });
    const cold = await timed(() => buildState(pmo, deps(dir)));
    assert.equal(cold.value.todos.length, COUNT);
    const reads = pmo.store.stats.fileReads;
    const warm = [];
    for (let i = 0; i < 5; i++)
      warm.push((await timed(() => buildState(pmo, deps(dir)))).ms);
    warm.sort((a, b) => a - b);
    const median = warm[2];
    assert.equal(pmo.store.stats.fileReads, reads, "no record file was read again");
    assert.ok(
      cold.ms > median * 10,
      `first ${cold.ms.toFixed(1)} ms, unchanged ${median.toFixed(1)} ms`,
    );
  });

  it("a change made here or from outside shows up on the next poll", async () => {
    const pmo = await createPmo({ dataDir: dir, generator });
    const before = await buildState(pmo, deps(dir));
    const one = { ...before.todos[0], title: "Renamed" };
    await pmo.store.putTodo(one);
    const renamed = await buildState(pmo, deps(dir));
    assert.equal(renamed.todos.find((t) => t.id === one.id).title, "Renamed");

    const extra = todoOf(COUNT + 1);
    await writeFile(
      path.join(pmo.store.paths.todos, `${extra.id}.json`),
      JSON.stringify(extra),
    );
    const added = await buildState(pmo, deps(dir));
    assert.equal(added.todos.length, COUNT + 1);

    await pmo.store.removeTodo(extra.id);
    assert.equal((await buildState(pmo, deps(dir))).todos.length, COUNT);
  });

  it("the badge summary matches the full state's attention counts and is cheap", async () => {
    const pmo = await createPmo({ dataDir: dir, generator });
    const full = await buildState(pmo, deps(dir));
    const summary = await timed(() => buildSummary(pmo));
    assert.deepEqual(summary.value.attention, full.attention);
    assert.equal(summary.value.today, full.today);
    const again = await timed(() => buildSummary(pmo));
    assert.ok(again.ms < 50, `${again.ms.toFixed(1)} ms`);
  });
});
