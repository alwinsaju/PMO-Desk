// Run with `pnpm test`. The AI-OS folder layout shared with Power Automate.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aiOsFolders,
  describeFolders,
  ensureAiOsFolders,
  folderStatus,
  foldersToCreate,
  legacyFolders,
  pickStaffExchange,
} from "./folders.ts";

const OD = "C:\\Users\\pat\\OneDrive - Deloitte (O365D)";

describe("the AI-OS folder", () => {
  it("holds the three folders in one place", () => {
    const f = aiOsFolders(`${OD}\\`);
    assert.equal(f.root, `${OD}\\AI-OS`);
    assert.equal(f.pmoInbox, `${OD}\\AI-OS\\PMO-Inbox`);
    assert.equal(f.staffExchange, `${OD}\\AI-OS\\Staff-Exchange`);
    assert.equal(f.ptoInbox, `${OD}\\AI-OS\\PTO-Inbox`);
    assert.deepEqual(
      describeFolders(f).map((x) => x.name),
      ["PMO-Inbox", "Staff-Exchange", "PTO-Inbox"],
    );
  });

  it("knows where the older installs kept two of them", () => {
    assert.deepEqual(legacyFolders(OD), {
      pmoInbox: `${OD}\\PMO-Inbox`,
      staffExchange: `${OD}\\Staff-Exchange`,
    });
  });

  it("lists every folder to create, parents first, with the profile hand-over's three sub-folders", () => {
    const list = foldersToCreate(aiOsFolders(OD));
    assert.equal(list[0], `${OD}\\AI-OS`);
    for (const sub of ["requests", "profiles", "rejected"]) {
      assert.ok(list.includes(`${OD}\\AI-OS\\Staff-Exchange\\${sub}`));
    }
    for (const dir of list) {
      const parent = dir.slice(0, dir.lastIndexOf("\\"));
      if (parent.endsWith("AI-OS") && dir !== list[0]) continue;
      assert.ok(list.indexOf(parent) < list.indexOf(dir) || parent === OD);
    }
  });

  it("works with forward slashes too", () => {
    assert.equal(
      aiOsFolders("/home/u/OneDrive").ptoInbox,
      "/home/u/OneDrive/AI-OS/PTO-Inbox",
    );
  });
});

describe("creating the folders", () => {
  it("creates what is missing, leaves what exists, and reports a failure without stopping", async () => {
    const f = aiOsFolders(OD);
    const existing = new Set([f.root, f.pmoInbox]);
    const made = [];
    const result = await ensureAiOsFolders(f, {
      isDirectory: (d) => existing.has(d),
      mkdir: async (d) => {
        if (d.endsWith("PTO-Inbox")) throw new Error("access denied");
        made.push(d);
      },
    });
    assert.ok(!made.includes(f.root) && !made.includes(f.pmoInbox));
    assert.ok(made.includes(f.staffExchange));
    assert.deepEqual(result.created, made);
    assert.deepEqual(result.failed, [{ path: f.ptoInbox, reason: "access denied" }]);
  });

  it("does nothing when everything is there", async () => {
    const f = aiOsFolders(OD);
    const all = new Set(foldersToCreate(f));
    const result = await ensureAiOsFolders(f, {
      isDirectory: (d) => all.has(d),
      mkdir: async () => assert.fail("must not create anything"),
    });
    assert.deepEqual(result, { created: [], failed: [] });
  });

  it("can be limited to some folders, so one that lives in an older place is not made twice", async () => {
    const f = aiOsFolders(OD);
    const made = [];
    await ensureAiOsFolders(
      f,
      { isDirectory: () => false, mkdir: async (d) => void made.push(d) },
      ["ptoInbox"],
    );
    assert.deepEqual(made, [f.root, f.ptoInbox]);
  });
});

describe("telling what is there", () => {
  it("counts an older PMO-Inbox and Staff-Exchange as found", () => {
    const dirs = new Set([`${OD}\\PMO-Inbox`, `${OD}\\Staff-Exchange`]);
    const s = folderStatus(OD, (d) => dirs.has(d));
    assert.deepEqual(s.found, { pmoInbox: true, staffExchange: true, ptoInbox: false });
    assert.equal(s.rootFound, false);
  });

  it("keeps the older Staff-Exchange while it exists (a flow watches that exact folder), else uses AI-OS", () => {
    const legacyOnly = new Set([`${OD}\\Staff-Exchange`]);
    assert.equal(
      pickStaffExchange(OD, (d) => legacyOnly.has(d)),
      `${OD}\\Staff-Exchange`,
    );
    const both = new Set([`${OD}\\Staff-Exchange`, `${OD}\\AI-OS\\Staff-Exchange`]);
    assert.equal(
      pickStaffExchange(OD, (d) => both.has(d)),
      `${OD}\\Staff-Exchange`,
    );
    assert.equal(
      pickStaffExchange(OD, () => false),
      `${OD}\\AI-OS\\Staff-Exchange`,
    );
  });
});
