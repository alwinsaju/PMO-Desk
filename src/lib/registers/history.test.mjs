import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerById } from "./defs.ts";
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_TRIM_BYTES,
  changedFields,
  describeEntry,
  entriesFor,
  entryForSave,
  parseHistory,
  serializeEntries,
  trimHistory,
} from "./history.ts";
import {
  applyRegisterChanges,
  historyFile,
  readRecordHistory,
  readRegister,
  registersDir,
} from "./server.ts";

const raid = registerById("raid");
const AT = "2026-03-05T10:00:00.000Z";
const inOrder = (keys) => raid.fields.map((f) => f.key).filter((k) => keys.includes(k));
const tempRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aios-history-"));
  return { root, env: { AI_OS_PMO_DATA_DIR: root } };
};
const clockFrom = (start) => {
  let n = 0;
  return () => new Date(Date.parse(start) + ++n * 60_000).toISOString();
};

test("changedFields: only fields that differ, in field order; unset equals empty", () => {
  assert.deepEqual(
    changedFields(
      raid,
      { title: "A", status: "Open", owner: "" },
      { title: "B", status: "Closed" },
    ),
    inOrder(["title", "status"]),
  );
  assert.deepEqual(changedFields(raid, { owner: "" }, {}), []);
  const tagged = { ...raid, fields: [{ key: "t", label: "T", type: "tags" }] };
  assert.deepEqual(changedFields(tagged, { t: ["a", "b"] }, { t: ["a", "b"] }), []);
  assert.deepEqual(changedFields(tagged, { t: ["a", "b"] }, { t: ["b", "a"] }), ["t"]);
});

test("entryForSave: created, changed with keys only, or nothing when no field changed", () => {
  const rec = (values) => ({
    id: "rg_aaaaaaaaaaaa",
    createdAt: AT,
    updatedAt: AT,
    values,
  });
  assert.deepEqual(entryForSave(raid, undefined, rec({ title: "A" }), AT), {
    at: AT,
    id: "rg_aaaaaaaaaaaa",
    kind: "created",
  });
  const changed = entryForSave(raid, rec({ title: "A" }), rec({ title: "Zebra" }), AT);
  assert.deepEqual(changed.fields, ["title"]);
  assert.equal(JSON.stringify(changed).includes("Zebra"), false);
  assert.equal(entryForSave(raid, rec({ title: "A" }), rec({ title: "A" }), AT), null);
});

test("parseHistory skips damaged lines; trim keeps the newest; describe uses field labels", () => {
  const good = {
    at: AT,
    id: "rg_aaaaaaaaaaaa",
    kind: "changed",
    fields: ["title", "bad key!"],
  };
  const text = [
    "not json",
    JSON.stringify({ at: "nope", id: "rg_aaaaaaaaaaaa", kind: "created" }),
    JSON.stringify({ at: AT, id: "bad", kind: "created" }),
    JSON.stringify({ at: AT, id: "rg_aaaaaaaaaaaa", kind: "weird" }),
    JSON.stringify(good),
    "",
  ].join("\n");
  const entries = parseHistory(text);
  assert.deepEqual(entries, [
    { at: AT, id: "rg_aaaaaaaaaaaa", kind: "changed", fields: ["title"] },
  ]);
  assert.equal(describeEntry(raid, entries[0]), "Changed Title");
  assert.equal(
    describeEntry(raid, { at: AT, id: "x", kind: "changed", fields: ["zzz"] }),
    "Changed zzz",
  );
  assert.equal(describeEntry(raid, { at: AT, id: "x", kind: "created" }), "Created");
  assert.equal(describeEntry(raid, { at: AT, id: "x", kind: "deleted" }), "Deleted");
  const many = Array.from({ length: 10 }, (_, i) => ({
    at: AT,
    id: "rg_aaaaaaaaaaaa",
    kind: "changed",
    fields: [`f${i}`],
  }));
  assert.deepEqual(
    trimHistory(many, 3).map((e) => e.fields[0]),
    ["f7", "f8", "f9"],
  );
  assert.deepEqual(
    entriesFor(many, "rg_aaaaaaaaaaaa", 2).map((e) => e.fields[0]),
    ["f9", "f8"],
  );
});

test("server: a save logs created / changed / deleted with field names only", async () => {
  const { root, env } = await tempRoot();
  try {
    const clock = clockFrom("2026-03-05T09:00:00.000Z");
    const first = await applyRegisterChanges(
      raid,
      {
        upsert: [
          { values: { kind: "Risk", title: "Secret vendor plan", status: "Open" } },
        ],
      },
      env,
      clock,
    );
    const id = first.items[0].id;
    // A save that changes nothing logs nothing.
    await applyRegisterChanges(
      raid,
      { upsert: [{ id, values: first.items[0].values }] },
      env,
      clock,
    );
    await applyRegisterChanges(
      raid,
      {
        upsert: [
          {
            id,
            values: { ...first.items[0].values, status: "Closed", title: "Renamed" },
          },
        ],
      },
      env,
      clock,
    );
    await applyRegisterChanges(raid, { remove: [id, "rg_000000000000"] }, env, clock);

    const entries = await readRecordHistory(raid, id, env);
    assert.deepEqual(
      entries.map((e) => e.kind),
      ["deleted", "changed", "created"],
    );
    assert.deepEqual(entries[1].fields, inOrder(["title", "status"]));
    const raw = await readFile(historyFile(raid, env), "utf8");
    assert.equal(raw.includes("Secret vendor plan"), false);
    assert.equal(raw.includes("Renamed"), false);
    assert.equal(raw.trim().split("\n").length, 3, "removing an unknown id logs nothing");
    // The log is a separate file under registers/history, not part of the register file.
    assert.equal(
      path.dirname(historyFile(raid, env)),
      path.join(registersDir(env), "history"),
    );
    assert.deepEqual(await readRecordHistory(raid, "not-an-id", env), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server: old registers load and save unchanged, with no history needed", async () => {
  const { root, env } = await tempRoot();
  try {
    const dir = registersDir(env);
    await mkdir(dir, { recursive: true });
    const old = {
      version: 1,
      items: [
        {
          id: "rg_0123456789ab",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-02-01T00:00:00.000Z",
          values: { kind: "Risk", title: "Old", status: "Open" },
          todoId: "td_0123456789ab",
        },
        {
          id: "rg_ba9876543210",
          createdAt: "2025-01-02T00:00:00.000Z",
          updatedAt: "2025-02-02T00:00:00.000Z",
          values: { kind: "Issue", title: "Older", status: "Open" },
        },
      ],
      config: {},
    };
    await writeFile(path.join(dir, "raid.json"), JSON.stringify(old));
    const before = await readRegister(raid, env);
    assert.equal(before.items.length, 2);
    assert.deepEqual(await readRecordHistory(raid, "rg_0123456789ab", env), []);

    // Save only the second record; the first must come back exactly as it was.
    const after = await applyRegisterChanges(
      raid,
      {
        upsert: [
          {
            id: "rg_ba9876543210",
            values: { ...before.items[1].values, title: "Edited" },
          },
        ],
      },
      env,
      () => "2026-03-05T10:00:00.000Z",
    );
    assert.deepEqual(
      after.items.find((i) => i.id === "rg_0123456789ab"),
      before.items[0],
    );
    const onDisk = JSON.parse(await readFile(path.join(dir, "raid.json"), "utf8"));
    const allowed = ["id", "createdAt", "updatedAt", "values", "todoId"];
    for (const item of onDisk.items) {
      assert.deepEqual(
        Object.keys(item).filter((k) => !allowed.includes(k)),
        [],
        "no history field was added to a record",
      );
    }
    assert.deepEqual(Object.keys(onDisk).sort(), ["config", "items", "version"]);
    assert.deepEqual(await readRegister(raid, env), after);
    assert.deepEqual(
      (await readRecordHistory(raid, "rg_ba9876543210", env)).map((e) => e.kind),
      ["changed"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server: a history file that cannot be written never fails the save", async () => {
  const { root, env } = await tempRoot();
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const dir = registersDir(env);
    await mkdir(dir, { recursive: true });
    // A plain file where the history folder should be, so the log cannot be created.
    await writeFile(path.join(dir, "history"), "blocker");
    const saved = await applyRegisterChanges(
      raid,
      { upsert: [{ values: { kind: "Risk", title: "Still saved", status: "Open" } }] },
      env,
    );
    assert.equal(saved.items.length, 1);
    assert.equal((await readRegister(raid, env)).items[0].values.title, "Still saved");
    assert.deepEqual(await readRecordHistory(raid, saved.items[0].id, env), []);
  } finally {
    console.error = quiet;
    await rm(root, { recursive: true, force: true });
  }
});

test("server: the log is capped per tool", async () => {
  const { root, env } = await tempRoot();
  try {
    const file = historyFile(raid, env);
    await mkdir(path.dirname(file), { recursive: true });
    const filler = Array.from({ length: 6000 }, (_, i) => ({
      at: AT,
      id: "rg_ffffffffffff",
      kind: "changed",
      fields: [`f${i}`],
    }));
    const big = serializeEntries(filler);
    assert.ok(big.length > HISTORY_TRIM_BYTES);
    await writeFile(file, big);
    await applyRegisterChanges(
      raid,
      { upsert: [{ values: { kind: "Risk", title: "New", status: "Open" } }] },
      env,
    );
    const kept = parseHistory(await readFile(file, "utf8"));
    assert.equal(kept.length, HISTORY_MAX_ENTRIES);
    assert.equal(kept.at(-1).kind, "created", "the newest entry is kept");
    assert.equal(kept[0].fields[0], `f${6000 - (HISTORY_MAX_ENTRIES - 1)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
