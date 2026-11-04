// Run with `pnpm test`. ops-4: optional milestone and payment dates on vendor contracts, their alerts,
// and (the part that must not break) vendor records saved before those fields existed.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { contractDateAlert, recordAlert, summarise } from "./alerts.ts";
import { registerById } from "./defs.ts";
import { fieldErrors, sanitizeValues } from "./records.ts";
import { applyRegisterChanges, readRegister } from "./server.ts";

const vendors = registerById("vendors");
const TODAY = "2026-03-05";
const ctx = { today: TODAY, config: {} };
const NOW = "2026-03-05T10:00:00.000Z";
const rec = (id, values) => ({
  id: `rg_${id.padStart(12, "0")}`,
  createdAt: NOW,
  updatedAt: NOW,
  values,
});
const NEW_KEYS = [
  "milestone1",
  "milestone1Date",
  "milestone2",
  "milestone2Date",
  "paymentNote",
  "paymentDate",
];

test("vendors: the new fields exist and are all optional text or date", () => {
  for (const key of NEW_KEYS) {
    const f = vendors.fields.find((x) => x.key === key);
    assert.ok(f, key);
    assert.ok(f.type === "text" || f.type === "date", `${key} is ${f.type}`);
    assert.notEqual(f.required, true, `${key} must not be required`);
    assert.equal(f.default, undefined, `${key} must start blank`);
  }
  // The form lists every field once.
  const grouped = vendors.formGroups.flatMap((g) => g.keys);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual([...grouped].sort(), vendors.fields.map((f) => f.key).sort());
});

test("vendors: a record without the new fields, or with them blank, is still valid", () => {
  const old = {
    vendor: "Acme",
    contract: "MSA",
    owner: "Priya",
    status: "Active",
    startDate: "2025-01-01",
    renewalDate: "2026-12-01",
    noticeDays: 60,
    value: "10k",
    notes: "n",
  };
  const parsed = sanitizeValues(vendors, old);
  assert.equal(parsed.ok, true);
  for (const key of NEW_KEYS) assert.equal(parsed.values[key], "");
  assert.deepEqual(fieldErrors(vendors, old), {});
  assert.deepEqual(
    fieldErrors(vendors, { ...old, milestone1Date: "", paymentDate: "" }),
    {},
  );
  // A date that is filled in must still be a real one.
  assert.match(
    fieldErrors(vendors, { ...old, milestone1Date: "2026-13-40" }).milestone1Date,
    /not a real date/,
  );
});

test("vendors: old records on disk still load and survive a save of another record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aios-vendors-"));
  const env = { AI_OS_PMO_DATA_DIR: root };
  try {
    await mkdir(path.join(root, "registers"), { recursive: true });
    const oldValues = {
      vendor: "Old Co",
      contract: "Support",
      owner: "Sam",
      status: "Renewing",
      startDate: "2024-04-01",
      renewalDate: "2026-09-30",
      noticeDays: 30,
      value: "5k",
      notes: "kept",
    };
    const file = path.join(root, "registers", "vendors.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "rg_00000000aaaa",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-02-01T00:00:00.000Z",
            values: oldValues,
          },
        ],
        config: {},
      }),
    );

    const read = await readRegister(vendors, env);
    assert.equal(read.items.length, 1, "the old record loads");
    assert.equal(read.items[0].values.vendor, "Old Co");
    assert.equal(read.items[0].values.milestone1Date, "");

    // Saving an unrelated record rereads, revalidates and rewrites the file: the old record must stay.
    await applyRegisterChanges(
      vendors,
      {
        upsert: [
          {
            values: {
              vendor: "New Co",
              status: "Active",
              milestone1: "Go-live",
              milestone1Date: "2026-03-08",
            },
          },
        ],
      },
      env,
    );
    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.equal(onDisk.items.length, 2, "nothing was deleted by the save");
    const kept = onDisk.items.find((i) => i.id === "rg_00000000aaaa");
    for (const [key, value] of Object.entries(oldValues)) {
      assert.equal(kept.values[key], value, key);
    }
    assert.equal(kept.createdAt, "2025-01-01T00:00:00.000Z");

    // Editing the old record without touching the new fields also works.
    const edited = await applyRegisterChanges(
      vendors,
      { upsert: [{ id: "rg_00000000aaaa", values: { ...oldValues, notes: "edited" } }] },
      env,
    );
    assert.equal(edited.items.length, 2);
    assert.equal(
      edited.items.find((i) => i.id === "rg_00000000aaaa").values.notes,
      "edited",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("alerts: milestone and payment dates", () => {
  const a = (values) =>
    recordAlert(vendors, rec("1", { status: "Active", noticeDays: 60, ...values }), ctx);
  // Nothing set, nothing new.
  assert.equal(a({}), null);
  assert.equal(a({ milestone1Date: "" }), null);
  assert.deepEqual(a({ milestone1: "Go-live", milestone1Date: "2026-03-02" }), {
    level: "late",
    text: "Go-live: late by 3 days",
  });
  assert.deepEqual(a({ milestone2Date: "2026-03-05" }), {
    level: "soon",
    text: "Milestone 2: due today",
  });
  assert.deepEqual(a({ paymentNote: "Q1 invoice", paymentDate: "2026-03-12" }), {
    level: "soon",
    text: "Q1 invoice: due in 7 days",
  });
  assert.equal(a({ paymentDate: "2026-03-13" }), null, "more than a week out");
  assert.deepEqual(a({ paymentDate: "2026-03-01" }), {
    level: "late",
    text: "Payment: late by 4 days",
  });
  // Late beats soon; the earliest date wins within a level.
  assert.equal(
    contractDateAlert(
      rec("1", {
        milestone1: "A",
        milestone1Date: "2026-03-06",
        milestone2: "B",
        milestone2Date: "2026-03-03",
        paymentDate: "2026-03-01",
      }),
      ctx,
    ).text,
    "Payment: late by 4 days",
  );
  // The renewal rule still applies and wins a tie; a stronger milestone beats a quiet renewal.
  assert.equal(
    a({ renewalDate: "2026-03-01", milestone1Date: "2026-03-02" }).text,
    "Renewal date has passed",
  );
  assert.equal(
    a({ renewalDate: "2026-05-20", milestone1Date: "2026-03-02" }).level,
    "late",
    "a renewal that is only due soon does not hide a late milestone",
  );
  assert.deepEqual(a({ renewalDate: "2026-05-20", noticeDays: 10 }), {
    level: "info",
    text: "Renews in 76 days",
  });
  // An ended contract never alerts.
  assert.equal(
    recordAlert(
      vendors,
      rec("1", { status: "Ended", milestone1Date: "2026-03-01" }),
      ctx,
    ),
    null,
  );
});

test("summaries: a late milestone counts as late for the register", () => {
  const items = [
    rec("1", { vendor: "A", status: "Active", milestone1Date: "2026-03-01" }),
    rec("2", { vendor: "B", status: "Active", paymentDate: "2026-03-07" }),
    rec("3", { vendor: "C", status: "Active" }),
    rec("4", { vendor: "D", status: "Ended", milestone1Date: "2026-03-01" }),
  ];
  const s = summarise(vendors, items, ctx);
  assert.equal(s.late, 1);
  assert.equal(s.soon, 1);
  assert.equal(s.open, 3);
});
