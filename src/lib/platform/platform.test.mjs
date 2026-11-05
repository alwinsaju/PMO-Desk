import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32 } from "node:zlib";
import {
  actionCounts,
  actionLabel,
  auditRows,
  filterAudit,
  parseAuditLine,
  parseAuditText,
} from "./auditView.ts";
import {
  BACKUP_MANIFEST,
  createBackup,
  folderSize,
  inspectBackup,
  listBackupFiles,
  restoreBackup,
} from "./backup.ts";
import { buildDiagnostics, collectDiagnostics, desktopLogPath } from "./diagnostics.ts";
import {
  exportCsvZip,
  exportJson,
  peopleRows,
  readExportData,
  timeOffRows,
  todoRows,
} from "./dataExport.ts";
import { readAudit } from "./auditServer.ts";
import { redact, tailLines } from "./redact.ts";
import { readZip, unsafeEntryName, writeZip, ZipError } from "./zip.ts";

const enc = (s) => Buffer.from(s, "utf8");
const dec = (b) => Buffer.from(b).toString("utf8");

/** A zip whose last entry has a name writeZip would refuse (swapped in byte for byte, so the checksums still match). */
function writeZipUnchecked(entries) {
  const last = entries[entries.length - 1];
  const placeholder = "q".repeat(last.name.length);
  const zip = writeZip([...entries.slice(0, -1), { ...last, name: placeholder }]);
  return Buffer.from(zip.toString("latin1").replaceAll(placeholder, last.name), "latin1");
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "aios-platform-"));
}

async function seed(root) {
  await mkdir(path.join(root, "todos"), { recursive: true });
  await mkdir(path.join(root, "staff"), { recursive: true });
  await mkdir(path.join(root, "templates"), { recursive: true });
  await mkdir(path.join(root, "logs"), { recursive: true });
  await mkdir(path.join(root, "backups"), { recursive: true });
  await writeFile(
    path.join(root, "todos", "td_aaaaaaaa.json"),
    JSON.stringify({
      id: "td_aaaaaaaa",
      title: "Send invoice",
      status: "open",
      priority: "high",
      dueAt: "2026-03-02",
      owner: { name: "Sam", email: "sam@x.com", isMe: false },
      requester: { name: "Ana", email: null },
      tags: ["a", "b"],
    }),
  );
  await writeFile(
    path.join(root, "staff", "employees.json"),
    JSON.stringify({
      version: 1,
      items: [
        {
          id: "e1",
          firstName: "Ana",
          lastName: "Lopez",
          deloitteEmail: "ana@x.com",
          team: "Ops",
          gender: "secret",
          skills: ["sql"],
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "staff", "timeoff.json"),
    JSON.stringify({
      version: 1,
      items: [
        {
          id: "t1",
          employeeId: "e1",
          type: "annual",
          startDate: "2026-03-02",
          endDate: "2026-03-03",
          status: "approved",
          reason: "trip",
        },
      ],
    }),
  );
  await writeFile(
    path.join(root, "templates", "library.json"),
    JSON.stringify({
      templates: [{ id: "tpl_1", name: "Chaser", kind: "email", usedBy: ["a"] }],
    }),
  );
  await writeFile(path.join(root, "logs", "ingest.jsonl"), "noise\n");
  await writeFile(path.join(root, "backups", "old.zip"), "old");
  await writeFile(
    path.join(root, "audit.jsonl"),
    `${JSON.stringify({ ts: "2026-03-01T10:00:00Z", action: "approve", user: "sam", proposalId: "pr_1" })}\n`,
  );
}

test("zip: round trip keeps names and bytes, compressing when it helps", () => {
  const big = enc("hello ".repeat(500));
  const zip = writeZip([
    { name: "a.txt", data: enc("hi") },
    { name: "dir/b.txt", data: big },
    { name: "empty.txt", data: new Uint8Array(0) },
  ]);
  const out = readZip(zip);
  assert.deepEqual(
    out.map((e) => e.name),
    ["a.txt", "dir/b.txt", "empty.txt"],
  );
  assert.equal(dec(out[1].data), dec(big));
  assert.ok(zip.length < big.length, "the repeated text is deflated");
  assert.equal(out[2].data.length, 0);
});

test("zip: refuses unsafe names when writing and reading", () => {
  for (const name of ["../x", "/abs", "C:/x", "a\\b", "a/../b", "", "a/./b"]) {
    assert.ok(unsafeEntryName(name), name);
    assert.throws(() => writeZip([{ name, data: enc("x") }]), ZipError);
  }
  assert.equal(unsafeEntryName("ok/file.json"), null);
  assert.throws(
    () =>
      writeZip([
        { name: "a", data: enc("1") },
        { name: "a", data: enc("2") },
      ]),
    /twice/,
  );
});

test("zip: a hand-made archive with a slip name is refused on read", () => {
  const zip = Buffer.from(writeZip([{ name: "safe.txt", data: enc("x") }]));
  const evil = Buffer.from(
    zip.toString("latin1").replaceAll("safe.txt", "../e.txt"),
    "latin1",
  );
  assert.throws(() => readZip(evil), /climbs out/);
});

test("zip: damage is detected (not a zip, flipped byte, truncation)", () => {
  assert.throws(() => readZip(enc("hello world, definitely not a zip")), ZipError);
  assert.throws(() => readZip(new Uint8Array(3)), ZipError);
  const zip = Buffer.from(writeZip([{ name: "a.txt", data: enc("x".repeat(50)) }]));
  const flipped = Buffer.from(zip);
  flipped[35] ^= 0xff;
  assert.throws(() => readZip(flipped), ZipError);
  assert.throws(() => readZip(zip.subarray(0, zip.length - 10)), ZipError);
  const raw = enc("plain");
  const stored = writeZip([{ name: "p", data: raw }]);
  assert.equal(crc32(raw) >>> 0, stored.readUInt32LE(14));
});

test("zip: limits stop an oversized archive", () => {
  const zip = writeZip([
    { name: "a", data: enc("1234567890") },
    { name: "b", data: enc("1234567890") },
  ]);
  assert.throws(
    () => readZip(zip, { maxEntries: 1, maxTotalBytes: 1e6, maxEntryBytes: 1e6 }),
    /limit/,
  );
  assert.throws(
    () => readZip(zip, { maxEntries: 9, maxTotalBytes: 15, maxEntryBytes: 1e6 }),
    /more than/,
  );
  assert.throws(
    () => readZip(zip, { maxEntries: 9, maxTotalBytes: 1e6, maxEntryBytes: 5 }),
    /larger/,
  );
});

test("backup: lists data files but not logs, backups or temp files", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    await writeFile(path.join(root, "todos", "x.json.tmp"), "t");
    const files = (await listBackupFiles(root)).map((f) => f.rel);
    assert.ok(files.includes("todos/td_aaaaaaaa.json"));
    assert.ok(files.includes("audit.jsonl"));
    assert.ok(
      !files.some(
        (f) => f.startsWith("logs/") || f.startsWith("backups/") || f.endsWith(".tmp"),
      ),
    );
    const size = await folderSize(root);
    assert.equal(size.files, files.length);
    assert.ok(size.bytes > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup: restore puts back the saved files and keeps a safety copy", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    const zip = await createBackup(root, {
      appVersion: "9.9.9",
      now: new Date("2026-03-05T10:00:00Z"),
    });
    const { manifest } = inspectBackup(zip);
    assert.equal(manifest.appVersion, "9.9.9");
    assert.equal(manifest.createdAt, "2026-03-05T10:00:00.000Z");

    // Change the data: edit one file, delete one, add one.
    await writeFile(path.join(root, "todos", "td_aaaaaaaa.json"), '{"id":"changed"}');
    await rm(path.join(root, "staff", "timeoff.json"));
    await writeFile(path.join(root, "todos", "td_bbbbbbbb.json"), "{}");

    const result = await restoreBackup(root, zip, {
      appVersion: "9.9.9",
      now: new Date("2026-03-06T10:00:00Z"),
    });
    assert.equal(result.removed, 1);
    assert.equal(
      JSON.parse(await readFile(path.join(root, "todos", "td_aaaaaaaa.json"), "utf8"))
        .title,
      "Send invoice",
    );
    assert.ok(await readFile(path.join(root, "staff", "timeoff.json"), "utf8"));
    assert.deepEqual(await readdir(path.join(root, "todos")), ["td_aaaaaaaa.json"]);

    // The safety copy holds what was replaced.
    const safety = inspectBackup(await readFile(result.safetyCopy));
    const changed = safety.entries.find((e) => e.name === "todos/td_aaaaaaaa.json");
    assert.equal(dec(changed.data), '{"id":"changed"}');
    assert.ok(safety.entries.some((e) => e.name === "todos/td_bbbbbbbb.json"));
    // logs and the old backups folder were left alone
    assert.equal(
      await readFile(path.join(root, "logs", "ingest.jsonl"), "utf8"),
      "noise\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup: keeps only the latest three safety copies", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    const zip = await createBackup(root, { appVersion: "1" });
    for (let i = 1; i <= 5; i++) {
      await restoreBackup(root, zip, {
        appVersion: "1",
        now: new Date(Date.UTC(2026, 0, i)),
      });
    }
    const copies = (await readdir(path.join(root, "backups"))).filter((n) =>
      n.startsWith("before-restore-"),
    );
    assert.equal(copies.length, 3);
    assert.ok(copies.some((n) => n.includes("2026-01-05")));
    assert.ok(!copies.some((n) => n.includes("2026-01-01")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup: refuses a zip that is not a backup, or is built to escape", () => {
  assert.throws(
    () => inspectBackup(writeZip([{ name: "a.txt", data: enc("x") }])),
    /not a PMO Desk backup/,
  );
  const manifest = {
    name: BACKUP_MANIFEST,
    data: enc(JSON.stringify({ format: "ai-os-backup", version: 1 })),
  };
  assert.throws(
    () =>
      inspectBackup(
        writeZip([
          {
            name: BACKUP_MANIFEST,
            data: enc(JSON.stringify({ format: "other", version: 1 })),
          },
        ]),
      ),
    /cannot read/,
  );
  assert.throws(
    () => inspectBackup(writeZip([manifest, { name: "logs/x", data: enc("x") }])),
    /not something a backup/,
  );
  assert.throws(
    () => inspectBackup(writeZip([manifest, { name: "backups/x.zip", data: enc("x") }])),
    /not something a backup/,
  );
  assert.throws(
    () => inspectBackup(writeZip([manifest, { name: "a.tmp", data: enc("x") }])),
    /Refused/,
  );
  assert.throws(
    () => inspectBackup(writeZip([{ name: BACKUP_MANIFEST, data: enc("{nope") }])),
    /damaged/,
  );
  assert.equal(
    inspectBackup(writeZip([manifest, { name: "todos/a.json", data: enc("{}") }])).entries
      .length,
    1,
  );
});

test("backup: refuses names Windows cannot store, including on ?check", () => {
  const manifest = {
    name: BACKUP_MANIFEST,
    data: enc(JSON.stringify({ format: "ai-os-backup", version: 1 })),
  };
  const bad = [
    "config.json:evil",
    "todos/CON",
    "todos/con.json",
    "NUL.txt",
    "aux",
    "COM1",
    "lpt9.log",
    "todos/a.json.",
    "todos/a.json ",
    "todos/a?.json",
    "todos/a<b>.json",
    "a//b.json",
  ];
  for (const name of bad) {
    assert.ok(unsafeEntryName(name), name);
    assert.throws(
      () => inspectBackup(writeZipUnchecked([manifest, { name, data: enc("x") }])),
      ZipError,
      name,
    );
  }
  for (const name of [
    "todos/console.json",
    "com10.json",
    "todos/a b.json",
    "audit.jsonl",
  ]) {
    assert.equal(unsafeEntryName(name), null, name);
  }
  assert.throws(
    () =>
      inspectBackup(
        writeZip([
          manifest,
          { name: "todos/A.json", data: enc("1") },
          { name: "todos/a.json", data: enc("2") },
        ]),
      ),
    /capital letters/,
  );
});

test("backup: a write failure part-way rolls everything back", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    const zip = await createBackup(root, { appVersion: "1" });
    // A folder where the backup wants a file makes the move fail after the old files were set aside.
    const clash = path.join(root, "todos", "td_aaaaaaaa.json");
    await rm(clash);
    await mkdir(clash);
    await writeFile(path.join(clash, "inner.json"), "keep me");
    const before = (await listBackupFiles(root)).map((f) => f.rel);
    await assert.rejects(
      restoreBackup(root, zip, {
        appVersion: "1",
        now: new Date("2026-03-06T10:00:00Z"),
      }),
      (error) => error instanceof ZipError && /nothing was changed/.test(error.message),
    );
    assert.deepEqual(
      (await listBackupFiles(root)).map((f) => f.rel),
      before,
    );
    assert.equal(await readFile(path.join(clash, "inner.json"), "utf8"), "keep me");
    assert.equal(
      await readFile(path.join(root, "audit.jsonl"), "utf8").then((t) => t.length > 0),
      true,
    );
    // The working folder is gone and a safety copy exists.
    const left = await readdir(path.join(root, "backups"));
    assert.ok(!left.some((n) => n.startsWith(".restore-")));
    assert.ok(left.some((n) => n.startsWith("before-restore-")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export: JSON and CSV carry the data but not the private field", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    const data = await readExportData(root);
    assert.equal(data.todos.length, 1);
    assert.equal(data.employees.length, 1);
    assert.equal("gender" in data.employees[0], false);
    const json = JSON.parse(exportJson(data, new Date("2026-03-05T00:00:00Z"), "5.7.0"));
    assert.equal(json.format, "ai-os-export");
    assert.equal(json.appVersion, "5.7.0");
    assert.equal(json.templates[0].name, "Chaser");
    assert.ok(!JSON.stringify(json).includes("secret"));

    const files = Object.fromEntries(
      readZip(exportCsvZip(data)).map((e) => [e.name, dec(e.data)]),
    );
    assert.deepEqual(Object.keys(files), [
      "todos.csv",
      "people.csv",
      "time-off.csv",
      "templates.csv",
    ]);
    assert.ok(files["todos.csv"].startsWith("\uFEFFId,Title"));
    assert.ok(files["todos.csv"].includes("Send invoice,open,high,2026-03-02,Sam,Ana"));
    assert.ok(files["time-off.csv"].includes("Ana Lopez,annual,2026-03-02"));
    assert.ok(!files["people.csv"].includes("secret"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export: rows tolerate odd records and quote commas", () => {
  assert.equal(todoRows([{ title: 'a, "b"' }], true)[1][1], 'a, "b"');
  assert.equal(todoRows([{}], true)[1][13], "yes");
  assert.equal(peopleRows([{}])[1].length, 10);
  assert.equal(timeOffRows([{ employeeId: "zz" }], [])[1][0], "zz");
});

test("audit: parses lines, skips noise, labels, filters and counts", () => {
  const lines = [
    JSON.stringify({
      ts: "2026-03-02T09:00:00Z",
      action: "approve",
      user: "sam",
      proposalId: "pr_1",
      tasks: 3,
    }),
    "not json",
    JSON.stringify({
      ts: "2026-03-03T09:00:00Z",
      action: "complete",
      user: "ana",
      todoId: "td_1",
    }),
    JSON.stringify({
      ts: "2026-03-04T09:00:00Z",
      action: "mystery-thing",
      user: "sam",
      list: [1, 2, 3, 4, 5],
    }),
    JSON.stringify({ nothing: true }),
    "",
  ].join("\n");
  const entries = parseAuditText(lines);
  assert.deepEqual(
    entries.map((e) => e.action),
    ["mystery-thing", "complete", "approve"],
  );
  assert.equal(parseAuditLine("[1]"), null);
  assert.equal(actionLabel("approve"), "Approved a suggested to-do");
  assert.equal(actionLabel("mystery-thing"), "mystery thing");
  assert.deepEqual(entries[2].details, ["proposalId: pr_1", "tasks: 3"]);
  assert.ok(entries[0].details[0].includes("+2"));
  assert.equal(filterAudit(entries, { action: "complete" }).length, 1);
  assert.equal(filterAudit(entries, { query: "ANA" }).length, 1);
  assert.equal(filterAudit(entries, { from: "2026-03-03", to: "2026-03-03" }).length, 1);
  assert.equal(filterAudit(entries, { query: "approved" }).length, 1);
  assert.equal(filterAudit(entries, {}).length, 3);
  assert.equal(actionCounts([...entries, ...entries])[0].count, 2);
  assert.equal(auditRows(entries)[1][2], "mystery thing");
});

test("audit: reads the newest lines across rotated copies", async () => {
  const root = await tempDir();
  try {
    const line = (day, action) =>
      JSON.stringify({ ts: `2026-03-${day}T00:00:00Z`, action, user: "u" });
    await writeFile(path.join(root, "audit.jsonl"), `${line("05", "approve")}\n`);
    await writeFile(path.join(root, "audit.1.jsonl"), `${line("03", "reject")}\n`);
    await writeFile(path.join(root, "audit.2.jsonl"), `${line("01", "edit")}\n`);
    const all = await readAudit(root);
    assert.deepEqual(
      all.entries.map((e) => e.action),
      ["approve", "reject", "edit"],
    );
    assert.equal((await readAudit(root, 2)).entries.length, 2);
    assert.equal((await readAudit(root, 2)).total, 3);
    assert.deepEqual((await readAudit(path.join(root, "none"))).entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redact: removes credentials, emails, ids, user names and network paths", () => {
  const text = [
    'password=hunter2 and "api_key": "abc123"',
    "Authorization: Bearer abcdefghijklmnop12345",
    "mail ana.lopez@deloitte.com failed",
    "id 0123456789abcdef0123456789abcdef0123",
    "C:\\Users\\alsaju\\AppData\\Local\\x.log",
    "\\\\fileserver\\share\\data.xlsx",
    "from 10.20.30.40 and 127.0.0.1",
    "alsaju did it",
  ].join("\n");
  const out = redact(text, ["alsaju"]);
  for (const secret of [
    "hunter2",
    "abc123",
    "abcdefghijklmnop12345",
    "ana.lopez",
    "0123456789abcdef",
    "fileserver",
    "10.20.30.40",
  ]) {
    assert.ok(!out.includes(secret), `${secret} still present`);
  }
  assert.ok(!out.includes("alsaju"));
  assert.ok(out.includes("127.0.0.1"));
  assert.ok(out.includes("[email]") && out.includes("[removed]"));
  assert.equal(tailLines("a\nb\nc\nd", 2), "c\nd");
  assert.equal(redact("nothing here"), "nothing here");
});

test("diagnostics: the bundle is cleaned and holds no record text", async () => {
  const entries = buildDiagnostics({
    appVersion: "5.7.0",
    now: new Date("2026-03-05T00:00:00Z"),
    platform: "win32",
    release: "10",
    arch: "x64",
    nodeVersion: "v26",
    userName: "alsaju",
    folderCounts: { todos: { files: 1, bytes: 10 } },
    counts: { todos: 1 },
    auditActions: [{ at: "2026-03-01T00:00:00Z", action: "approve" }],
    desktopLog: "start\nC:\\Users\\alsaju\\x token=abc\nuser ana@x.com",
    ingestLog: null,
  });
  const names = entries.map((e) => e.name);
  assert.deepEqual(names, [
    "README.txt",
    "summary.json",
    "audit-actions.csv",
    "desktop-log.txt",
  ]);
  const log = dec(entries[3].data);
  assert.ok(
    !log.includes("alsaju") && !log.includes("ana@x.com") && !log.includes("abc"),
  );
  assert.equal(JSON.parse(dec(entries[1].data)).appVersion, "5.7.0");
  assert.equal(
    desktopLogPath({
      AI_OS_DESKTOP_PREFS_FILE: "C:\\app\\data\\desktop-prefs.json",
    }).endsWith("desktop.log"),
    true,
  );
  assert.equal(desktopLogPath({}), null);
});

test("diagnostics: collecting from a data folder reads only counts and the cleaned logs", async () => {
  const root = await tempDir();
  try {
    await seed(root);
    await writeFile(path.join(root, "logs", "ingest.jsonl"), "scan ok ana@x.com\n");
    const zip = await collectDiagnostics(root, { appVersion: "5.7.0", env: {} });
    const files = Object.fromEntries(readZip(zip).map((e) => [e.name, dec(e.data)]));
    const summary = JSON.parse(files["summary.json"]);
    assert.equal(summary.counts.todos, 1);
    assert.equal(summary.counts.people, 1);
    assert.ok(!("desktop-log.txt" in files));
    assert.ok(!files["ingest-log.txt"].includes("ana@x.com"));
    assert.ok(!JSON.stringify(files).includes("Send invoice"));
    assert.ok(files["audit-actions.csv"].includes("approve"));
    assert.ok(!files["audit-actions.csv"].includes("sam"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
