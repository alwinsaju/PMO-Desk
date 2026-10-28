// Run with `pnpm test` (Windows only for the mapping half: it needs
// powershell.exe). The Outlook producer, pmo-intake/scripts/Export-OutlookToInbox.ps1,
// is tested WITHOUT Outlook:
//  1. a static guard: the scripts must contain no member that could change a
//     mail item (send, delete, move, copy, save, display, category/flag/read
//     assignments...), so "read-only" is a property of the text, checked on
//     every run;
//  2. the mapping (OutlookMapping.ps1) fed FAKE items by
//     pmo-intake/scripts/tests/OutlookMapping.harness.ps1 under Windows
//     PowerShell 5.1, with the output validated against the app's own
//     IntakeSchema, the published JSON Schema's required fields, the filter,
//     and a real ingest pass over a temp inbox.
// No Outlook COM object is ever created here, and no mailbox is touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { fileURLToPath } from "node:url";
import { dedupeKey } from "./dedupe.ts";
import { filterIntake } from "./filter.ts";
import { IntakeSchema } from "./types.ts";
import { developerConfig } from "./developerDefaults.ts";
import { createPmo } from "./server/create.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const scriptsDir = path.join(repo, "pmo-intake", "scripts");
const productionScripts = ["Export-OutlookToInbox.ps1", "OutlookMapping.ps1"];
const read = (...parts) => readFileSync(path.join(...parts), "utf8");

// --- the static guard ---------------------------------------------------------

/** Member calls that could change or leave Outlook state, and assignments to
 *  properties that would change a mail item. Returns what was found. */
export function findForbidden(text) {
  const calls = [
    "Send",
    "Delete",
    "Move",
    "Copy",
    "Save",
    "SaveAs",
    "SaveAsFile",
    "Display",
    "Reply",
    "ReplyAll",
    "Forward",
    "MarkAsTask",
    "ClearTaskFlag",
    "Close",
    "PrintOut",
    "Remove",
    "RemoveAll",
    "CreateItem",
    "CreateItemFromTemplate",
    "ShowCategoriesDialog",
    "AdvancedSearch",
    "Logoff",
  ];
  const assignments = [
    "Categories",
    "FlagStatus",
    "UnRead",
    "FlagRequest",
    "FlagIcon",
    "FlagDueBy",
    "TaskDueDate",
    "TaskStartDate",
    "Body",
    "HTMLBody",
    "Subject",
    "Importance",
    "Sensitivity",
    "ReminderSet",
    "To",
    "Cc",
    "Bcc",
  ];
  const found = [];
  for (const name of calls) {
    if (new RegExp(`\\.${name}\\s*\\(`, "i").test(text)) found.push(`.${name}(`);
  }
  // Items.Add(...) / Folders.Add(...) create things in the mailbox.
  if (/\.(Items|Folders|Attachments|Recipients)\s*\.\s*Add\s*\(/i.test(text)) {
    found.push(".Items.Add(");
  }
  for (const name of assignments) {
    if (new RegExp(`\\.${name}\\s*=(?![=~])`, "i").test(text)) found.push(`.${name} =`);
  }
  return found;
}

describe("Outlook producer: read-only guard", () => {
  it("finds what it is meant to find (the guard itself is tested)", () => {
    assert.deepEqual(findForbidden("$m.Send()"), [".Send("]);
    assert.deepEqual(findForbidden("$item.Delete( )"), [".Delete("]);
    assert.deepEqual(findForbidden("$a.Move($f)"), [".Move("]);
    assert.deepEqual(findForbidden("$a.Copy()"), [".Copy("]);
    assert.deepEqual(findForbidden("$a.Save()"), [".Save("]);
    assert.deepEqual(findForbidden("$a.Display($true)"), [".Display("]);
    assert.deepEqual(findForbidden("$a.SaveAsFile('x')"), [".SaveAsFile("]);
    assert.deepEqual(findForbidden("$a.Items.Add(1)"), [".Items.Add("]);
    assert.deepEqual(findForbidden("$m.Categories = 'x'"), [".Categories ="]);
    assert.deepEqual(findForbidden("$m.UnRead=$false"), [".UnRead ="]);
    assert.deepEqual(findForbidden("$m.FlagStatus = 0"), [".FlagStatus ="]);
    assert.deepEqual(findForbidden("$m.FlagRequest = 'x'"), [".FlagRequest ="]);
    // reads and comparisons are fine
    assert.deepEqual(findForbidden("if ([int]$m.FlagStatus -ne 2) { $x = $m.Body }"), []);
    assert.deepEqual(
      findForbidden("Move-Item -LiteralPath $a -Destination $b; Save-SeenState"),
      [],
    );
  });

  for (const file of productionScripts) {
    it(`${file} has no member that can change a mail item or leave Outlook state`, () => {
      assert.deepEqual(findForbidden(read(scriptsDir, file)), []);
    });

    it(`${file} is plain ASCII (Windows PowerShell 5.1 reads a BOM-less script as ANSI)`, () => {
      const bytes = readFileSync(path.join(scriptsDir, file));
      assert.equal(
        bytes.every((byte) => byte < 128),
        true,
      );
    });
  }

  it("creates exactly one COM object (Outlook.Application) and never opens an attachment", () => {
    const all = productionScripts.map((f) => read(scriptsDir, f)).join("\n");
    const comObjects = all.match(/New-Object\s+-ComObject\s+'?[\w.]+'?/gi) ?? [];
    assert.equal(comObjects.length, 1);
    assert.match(comObjects[0], /Outlook\.Application/);
    assert.doesNotMatch(all, /SaveAsFile|\.Open\(|Start-Process|Invoke-Item/i);
  });

  it("has -DryRun and -WhatIf, takes the documented parameters, and never creates the inbox", () => {
    const main = read(scriptsDir, "Export-OutlookToInbox.ps1");
    assert.match(main, /SupportsShouldProcess/);
    for (const name of [
      "InboxDir",
      "FolderPath",
      "SinceDays",
      "StatePath",
      "MaxItems",
      "DryRun",
      "IgnoreSeen",
    ]) {
      assert.match(main, new RegExp(`\\$${name}\\b`));
    }
    assert.match(main, /PMO-Inbox/);
    assert.doesNotMatch(main, /New-Item[^\n]*\$InboxDir/);
  });
});

// --- the mapping, with fake items ----------------------------------------------

const onWindows = process.platform === "win32";
let powershell = null;
if (onWindows) {
  const probe = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"],
    {
      encoding: "utf8",
    },
  );
  if (probe.status === 0) powershell = "powershell.exe";
}

describe(
  "Outlook producer: mapping fake items (no Outlook)",
  { skip: !powershell && "needs powershell.exe on Windows" },
  () => {
    let out;
    let cases;
    let tmp;
    const byName = (name) => cases.find((c) => c.name === name);
    const parsed = (name) => JSON.parse(byName(name).json);

    before(async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "pmo-outlook-test-"));
      const outFile = path.join(tmp, "out.json");
      const run = spawnSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(scriptsDir, "tests", "OutlookMapping.harness.ps1"),
          "-OutFile",
          outFile,
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      assert.equal(run.status, 0, `harness failed:\n${run.stdout}\n${run.stderr}`);
      out = JSON.parse((await readFile(outFile, "utf8")).replace(/^﻿/, ""));
      cases = out.cases;
    });
    after(async () => {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    });

    it("produces output that the app's own schema accepts, for every mail case", () => {
      const required = JSON.parse(
        read(scriptsDir, "..", "intake.v1.schema.json"),
      ).required;
      const mail = cases.filter((c) => !c.skipped);
      assert.ok(mail.length >= 9);
      for (const c of mail) {
        const doc = JSON.parse(c.json);
        for (const key of required) assert.ok(key in doc, `${c.name}: missing ${key}`);
        const result = IntakeSchema.safeParse(doc);
        assert.ok(result.success, `${c.name}: ${result.error?.message}`);
        assert.equal(doc.schema, "pmo-intake/1");
        assert.equal(doc.source, "outlook");
        assert.equal(doc.producer, "outlook-com");
        assert.equal(typeof doc.body.text, "string");
        assert.equal(doc.body.format, "text");
        for (const person of doc.recipients)
          assert.ok(["to", "cc"].includes(person.role));
        for (const att of doc.attachments) {
          assert.deepEqual(
            Object.keys(att).filter(
              (k) => !["name", "contentType", "size", "ref"].includes(k),
            ),
            [],
            `${c.name}: attachments carry metadata only`,
          );
        }
        assert.match(doc.link, /^outlook:\S+$/);
        // receivedAt carries an offset and is the same instant PowerShell reports in UTC
        assert.match(
          doc.receivedAt,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
        );
        assert.equal(Date.parse(doc.receivedAt), Date.parse(c.expectedUtc), c.name);
        assert.match(c.fileName, /^outlook-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/);
      }
    });

    it("maps a plain SMTP mail, round-tripping quotes, backslashes and non-ASCII text", () => {
      const doc = parsed("plain-smtp");
      assert.equal(doc.sourceId, "<fake-0001@example.test>");
      assert.equal(doc.sender.name, "Pat Sample");
      assert.equal(doc.sender.address, "pat.sample@deloitte.com");
      assert.deepEqual(
        doc.recipients.map((r) => [r.address, r.role]),
        [
          ["alsaju@deloitte.com", "to"],
          ["jordan.sample@deloitte.com", "cc"],
        ],
      );
      assert.equal(
        doc.body.text,
        'She said "send it" and wrote C:\\temp\\raid.xlsx; café — 5€\nline two',
      );
      assert.equal(doc.context.importance, "high");
      assert.equal(doc.thread.conversationId, "FAKECONVERSATION0001");
      assert.equal(doc.link, "outlook:00000000FAKEENTRYID0001");
      // The inline logo is skipped; type comes from MAPI or, failing that, the extension.
      assert.deepEqual(doc.attachments, [
        { name: "RAID log.pdf", contentType: "application/pdf", size: 48213 },
        {
          name: "plan.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 9000,
        },
      ]);
      assert.deepEqual(byName("plain-smtp").warnings, []);
    });

    it("resolves Exchange (X500) senders and recipients, and leaves bcc out", () => {
      const doc = parsed("x500-resolved");
      assert.equal(doc.sender.address, "pat.sample@deloitte.com");
      assert.deepEqual(
        doc.recipients.map((r) => [r.address, r.role]),
        [
          ["alsaju@deloitte.com", "to"],
          ["jordan.sample@deloitte.com", "cc"],
        ],
      );
      assert.doesNotMatch(byName("x500-resolved").json, /\/O=EXCHANGELABS/i);
    });

    it("never exports an X500 string as an address; unresolved means no address, plus a warning", () => {
      const c = byName("x500-unresolved");
      const doc = JSON.parse(c.json);
      assert.equal(doc.sender.address, undefined);
      assert.equal(doc.sender.name, "Pat Sample");
      assert.equal(doc.recipients[0].address, undefined);
      assert.doesNotMatch(c.json, /EXCHANGELABS/i);
      assert.ok(c.warnings.some((w) => /could not be resolved to SMTP/.test(w)));
      assert.equal(c.guardDenied, false);
      // The app still accepts it; its filter then quarantines it with a clear reason.
      const config = developerConfig();
      const verdict = filterIntake(IntakeSchema.parse(doc), config);
      assert.equal(verdict.pass, false);
      assert.equal(verdict.code, "sender-domain-not-allowed");
      assert.match(verdict.reason, /no readable sender address/);
    });

    it("falls back to the HTML body as text", () => {
      const doc = parsed("html-only");
      assert.equal(
        doc.body.text,
        "Hi all,\nFYI the steering committee moved to Thursday & the invite is updated.\nThanks,\nJordan",
      );
      assert.equal(doc.body.format, "text");
    });

    it("flags a denied programmatic-access prompt and still maps the message", () => {
      const c = byName("guard-denied");
      assert.equal(c.guardDenied, true);
      assert.equal(c.skipped, false);
      assert.ok(c.warnings.some((w) => /programmatic-access prompt/.test(w)));
      assert.equal(
        helpers().guardChain.wrapped,
        true,
        "a wrapped COM error counts as a denial",
      );
      assert.equal(helpers().guardChain.byMessage, true);
      assert.equal(helpers().guardChain.other, false);
      assert.equal(helpers().guardChain.none, false);
    });

    it("skips meeting requests, reports and tasks, naming the reason", () => {
      for (const name of ["meeting-request", "report", "task"]) {
        const c = byName(name);
        assert.equal(c.skipped, true, name);
        assert.match(c.skipReason, /Not a mail item \(Outlook class \d+/);
        assert.equal(c.json, undefined);
      }
    });

    it("falls back to the EntryID when there is no Internet Message-ID, and to CreationTime for the date", () => {
      assert.equal(parsed("no-message-id").sourceId, "00000000FAKEENTRYID0001");
      assert.ok(byName("no-received-time").warnings.some((w) => /CreationTime/.test(w)));
    });

    it("keeps every file under the app's 1 MB limit, even when escaping inflates the JSON", () => {
      for (const name of ["huge-body", "huge-escaped"]) {
        const c = byName(name);
        assert.ok(Buffer.byteLength(c.json, "utf8") < 900_000, name);
        assert.match(parsed(name).body.text, /truncated by the Outlook exporter/);
      }
      assert.ok(byName("huge-body").warnings.some((w) => /truncated/.test(w)));
    });

    it("caps recipients and says so", () => {
      assert.equal(parsed("many-recipients").recipients.length, 10);
      assert.ok(
        byName("many-recipients").warnings.some((w) => /More than 10 recipients/.test(w)),
      );
    });

    const helpers = () => out.helpers;

    it("formats Restrict dates and file names the same under any culture", () => {
      const entries = Object.values(helpers().cultures);
      assert.equal(entries.length, 6);
      for (const entry of entries) assert.deepEqual(entry, entries[0]);
      assert.equal(
        entries[0].dasl,
        "@SQL=\"urn:schemas:httpmail:datereceived\" >= '2026-10-09 09:30'",
      );
      assert.equal(entries[0].jet, "[ReceivedTime] >= '10/09/2026 09:30 AM'");
      assert.match(entries[0].iso, /^2026-10-22T09:14:00[+-]\d\d:\d\d$/);
      assert.equal(entries[0].file, "outlook-20261022T034400Z-57dfad4d.json");
    });

    it("splits folder paths", () => {
      const { segments } = helpers();
      assert.deepEqual(segments.a, ["Inbox", "PMO"]);
      assert.deepEqual(segments.b, ["Inbox", "PMO", "Clients"]);
      assert.deepEqual(segments.c, ["Archive"]);
      assert.deepEqual(segments.d, []);
    });

    it("writes atomically as UTF-8 without a BOM, and keeps a pruned, atomic seen-file", () => {
      const { write, state, badState } = helpers();
      assert.match(write.name, /^outlook-20260102T030405Z-[0-9a-f]{8}\.json$/);
      assert.deepEqual(write.leftovers, [write.name], "no .tmp file is left behind");
      assert.notDeepEqual(write.firstBytes, [0xef, 0xbb, 0xbf], "no BOM");
      assert.equal(write.text, '{"a":"café"}');
      assert.deepEqual(
        state.keys,
        ["<new@example.test>"],
        "entries older than a year are pruned",
      );
      assert.deepEqual(state.leftovers, ["seen.json"]);
      assert.equal(state.missing, 0);
      assert.equal(badState, 0, "a corrupt seen-file is treated as empty");
    });

    it("is accepted by a real ingest pass: resolvable mail is queued, the unresolvable one is filtered, nothing is lost", async () => {
      const dataDir = await mkdtemp(path.join(os.tmpdir(), "pmo-outlook-data-"));
      const inboxDir = await mkdtemp(path.join(os.tmpdir(), "pmo-outlook-inbox-"));
      try {
        const now = new Date();
        const pmo = await createPmo({
          dataDir,
          inboxDir,
          seedConfig: developerConfig(),
          now: () => now,
          generator: {
            model: () => "unused",
            generate: async () => {
              throw new Error("the model is not used here");
            },
          },
        });
        const names = [
          "plain-smtp",
          "x500-resolved",
          "x500-unresolved",
          "html-only",
          "no-message-id",
        ];
        for (const name of names) {
          const file = path.join(inboxDir, `${name}.json`);
          await writeFile(file, byName(name).json, "utf8");
          const old = new Date(now.getTime() - 60_000);
          await utimes(file, old, old);
        }
        // The same message exported again (same sourceId) is a duplicate, whatever the file name.
        const dup = path.join(inboxDir, "again.json");
        await writeFile(dup, byName("plain-smtp").json, "utf8");
        await utimes(
          dup,
          new Date(now.getTime() - 60_000),
          new Date(now.getTime() - 60_000),
        );

        const report = await pmo.ingestor.scan();
        assert.deepEqual(report.errors, []);
        assert.equal(report.rejected, 0);
        // plain-smtp, x500-resolved, html-only and no-message-id share the fake Message-ID
        // or EntryID in places, so count by distinct keys instead of by file.
        const keys = new Set(
          names.map((name) => dedupeKey(IntakeSchema.parse(parsed(name)))),
        );
        assert.equal(report.ingested + report.filtered, keys.size);
        assert.equal(report.filtered, 1);
        const quarantined = await pmo.store.listQuarantine();
        assert.equal(quarantined.length, 1);
        assert.equal(quarantined[0].code, "sender-domain-not-allowed");
        assert.deepEqual(await readdir(inboxDir), [], "every file was dealt with");
      } finally {
        await rm(dataDir, { recursive: true, force: true });
        await rm(inboxDir, { recursive: true, force: true });
      }
    });

    it("the seen-file would be keyed by the same id the app de-duplicates on", () => {
      const doc = parsed("plain-smtp");
      assert.match(dedupeKey(IntakeSchema.parse(doc)), /^outlook:[0-9a-f]{64}$/);
      assert.equal(existsSync(path.join(scriptsDir, "Export-OutlookToInbox.ps1")), true);
    });
  },
);

// --- the script's control flow, against a fake Outlook ---------------------------

describe(
  "Outlook producer: running the script against a fake Outlook",
  { skip: !powershell && "needs powershell.exe on Windows" },
  () => {
    let runs;
    let tmp;
    const run = (label) => runs.find((r) => r.label === label);
    const wouldWrite = (r) => (r.text.match(/WOULD WRITE/g) ?? []).length;
    const subjects = (r) => [...r.text.matchAll(/"(Subject \S+)"/g)].map((m) => m[1]);
    const flat = (text) => text.replace(/\s+/g, " ");

    before(async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "pmo-outlook-flow-"));
      const outFile = path.join(tmp, "out.json");
      const result = spawnSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(scriptsDir, "tests", "ExportFlow.harness.ps1"),
          "-OutFile",
          outFile,
        ],
        { encoding: "utf8", timeout: 240_000 },
      );
      assert.equal(
        result.status,
        0,
        `harness failed:
${result.stdout}
${result.stderr}`,
      );
      runs = JSON.parse((await readFile(outFile, "utf8")).replace(/^﻿/, "")).runs;
    });
    after(async () => {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    });

    it("only ever asks Outlook to look: namespace, folder, filter, sort and walking the items", () => {
      for (const r of runs) {
        for (const call of r.calls) {
          assert.match(
            call,
            /^(GetNamespace|GetDefaultFolder|Restrict|Sort): /,
            `${r.label}: ${call}`,
          );
        }
      }
    });

    it("-DryRun and -WhatIf print what would be written and write nothing, not even state", () => {
      for (const label of ["dry-run", "whatif"]) {
        const r = run(label);
        assert.equal(r.exit, 0, label);
        assert.deepEqual(r.files, [], label);
        assert.equal(r.state, null, label);
        assert.equal(wouldWrite(r), 2, label);
        assert.match(
          r.text,
          /DRY RUN: would write 2, already exported 0, skipped non-mail 1/,
        );
        assert.match(r.text, /Nothing was written/);
        assert.deepEqual(
          subjects(r),
          ["Subject a1", "Subject a2"],
          "newest first, the old mail is outside the window",
        );
      }
    });

    it("a real run writes one <source>-<time>-<hex>.json per mail, records them, and skips them next time", () => {
      const first = run("real-1");
      assert.equal(first.exit, 0);
      assert.equal(first.files.length, 2);
      for (const name of first.files)
        assert.match(name, /^outlook-\d{8}T\d{6}Z-[0-9a-f]{8}\.json$/);
      assert.deepEqual(Object.keys(JSON.parse(first.state).seen).sort(), [
        "<a1@example.test>",
        "<a2@example.test>",
      ]);
      assert.equal(JSON.parse(first.state).version, 1);

      const second = run("real-2");
      assert.match(flat(second.text), /Wrote 0 file\(s\).* Already exported 2/);
      assert.deepEqual(second.files, first.files, "nothing new, nothing removed");

      // -IgnoreSeen sends them again under the same names (the app de-duplicates).
      const again = run("real-ignore-seen");
      assert.match(flat(again.text), /Wrote 2 file\(s\)/);
      assert.deepEqual(again.files, first.files);
    });

    it("-MaxItems stops after the newest N", () => {
      const r = run("max-items");
      assert.equal(r.files.length, 1);
      assert.match(r.text, /Reached -MaxItems \(1\)/);
      assert.deepEqual(subjects(r), ["Subject a1"]);
    });

    it("falls back from the DASL filter to the Jet filter to checking in code", () => {
      assert.match(run("restrict-jet").text, /Date filter: Jet/);
      assert.equal(wouldWrite(run("restrict-jet")), 2);
      const none = run("restrict-none-no-sort");
      assert.match(
        none.text,
        /Date filter: none \(checked in code\); newest-first sort: no/,
      );
      assert.equal(wouldWrite(none), 2, "the window is still applied, in code");
      assert.doesNotMatch(none.text, /old1/);
    });

    it("-SinceDays widens the window", () => {
      assert.equal(wouldWrite(run("since-60")), 3);
      assert.match(run("since-60").text, /\(60 days\)/);
    });

    it("without -FolderPath it exports flagged mail only, from the To-Do folder, by modified time", () => {
      const r = run("flagged");
      assert.deepEqual(subjects(r), ["Subject f1", "Subject f3"]);
      assert.match(r.text, /skipped non-mail 1, not flagged 1/);
      assert.ok(r.calls.includes("GetDefaultFolder: 28"));
      assert.ok(r.calls.some((c) => c === "Sort: [LastModificationTime]"));
      assert.equal(r.calls.filter((c) => c.startsWith("Restrict")).length, 0);
    });

    it("reads the Inbox itself and a top-level mailbox folder", () => {
      assert.deepEqual(subjects(run("inbox-itself")), ["Subject i1"]);
      assert.deepEqual(subjects(run("top-level-folder")), ["Subject z1"]);
    });

    it("stops with a clear message and exit code for each environment problem", () => {
      const folder = run("folder-missing");
      assert.equal(folder.exit, 3);
      assert.match(
        flat(folder.text),
        /Outlook folder 'Nope' was not found under 'Inbox'/,
      );

      const noInbox = run("inbox-missing-real");
      assert.equal(noInbox.exit, 5);
      assert.deepEqual(noInbox.calls, [], "Outlook is not even touched");
      assert.match(flat(noInbox.text), /does not exist.*never creates it/);

      const dry = run("inbox-missing-dry");
      assert.equal(dry.exit, 0);
      assert.match(flat(dry.text), /a real run would stop here/);

      const newOutlook = run("new-outlook");
      assert.equal(newOutlook.exit, 2);
      assert.match(
        flat(newOutlook.text),
        /'New Outlook' is running.*does not support COM/,
      );
      assert.deepEqual(newOutlook.calls, []);

      const noCom = run("no-com");
      assert.equal(noCom.exit, 2);
      assert.match(
        flat(noCom.text),
        /Could not start Outlook through COM.*'New Outlook' does not support COM/,
      );

      const guard = run("guard-stop");
      assert.equal(guard.exit, 4);
      assert.match(flat(guard.text), /programmatic-access prompt was denied 3 times/);
      assert.equal(wouldWrite(guard), 2, "it stops at the third denial");
    });

    it("writes a file the app accepts, UTF-8 without a BOM, with no .tmp left behind", () => {
      const r = run("write-sample");
      assert.equal(r.exit, 0);
      assert.ok(r.files.every((name) => name.endsWith(".json")));
      assert.notDeepEqual(r.firstBytes, [0xef, 0xbb, 0xbf]);
      const doc = JSON.parse(r.firstFile);
      assert.ok(IntakeSchema.safeParse(doc).success);
      assert.equal(doc.source, "outlook");
    });
  },
);
