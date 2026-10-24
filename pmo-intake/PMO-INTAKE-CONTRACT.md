# PMO intake contract: `pmo-intake/1`

The PMO To-Do app does not read your mailbox or Teams. A **producer** writes one
JSON file per message into a folder, and the app picks the files up. This
document is the whole interface between the two. The producers are:

| Producer             | `producer`      | `source`            | What it is                                                                                                 |
| -------------------- | --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Power Automate flows | `pa-cloud-flow` | `outlook` / `teams` | Flagged email, and Teams "For a selected message" ([recipes](./PA-FLOW-RECIPES.md))                        |
| Outlook script       | `outlook-com`   | `outlook`           | Read-only export from classic Outlook ([`Export-OutlookToInbox.ps1`](./scripts/Export-OutlookToInbox.ps1)) |
| Paste button         | `manual-paste`  | `manual`            | You paste a message into the app; the app writes the file for you                                          |

- Start here: [`HOW-TO-GET-STARTED.md`](./HOW-TO-GET-STARTED.md)
- Machine-readable schema: [`intake.v1.schema.json`](./intake.v1.schema.json)
- Examples: [`examples/`](./examples)
- Click-by-click flow recipes: [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md)
- Sample writer for testing: [`scripts/New-SampleIntake.ps1`](./scripts/New-SampleIntake.ps1)

## Where files go

| Setting      | Default                                         | Override                                                  |
| ------------ | ----------------------------------------------- | --------------------------------------------------------- |
| Inbox folder | `C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox` | env `AI_OS_PMO_INBOX_DIR`, or `inboxDir` in `config.json` |

The app polls the folder every 15 seconds (and on **Scan now**). Rules for
producers:

1. **Write `<name>.tmp`, then rename to `<name>.json`.** The app only reads
   `*.json`. If your connector cannot rename, that is tolerated: files younger
   than 3 seconds are skipped, and a file that fails to parse is retried on 3
   scans before it is moved to `rejected-files/`.
2. One message per file, UTF-8, at most 1 MB (bigger files are skipped).
3. Use a unique file name (for example the sourceId or a GUID). The file name
   has no meaning; de-duplication uses `sourceId`.
4. The app **deletes** each file once it has dealt with it (ingested,
   duplicate, filtered). Its only write into the folder is the **Paste** button,
   which acts as one more producer: it writes `manual-<yyyymmddThhmmssZ>-<8 hex>.json`
   the same way (temp file, then rename) and the ordinary scan handles it.

## Fields

Required: `schema`, `source`, `sourceId`, `receivedAt`, `sender`, `subject`,
`body.text`. Everything else is optional. `null` counts as "not provided".

| Field         | Type                                                                                         | Notes                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `schema`      | `"pmo-intake/1"`                                                                             | Exactly this string.                                                                          |
| `producer`    | string                                                                                       | `pa-cloud-flow`, `outlook-com`, `manual-paste`, `other`. Informational.                       |
| `source`      | `"outlook"` \| `"teams"` \| `"manual"`                                                       | Drives the filter rules below.                                                                |
| `sourceId`    | string                                                                                       | Stable id of the message in its system; the de-duplication key.                               |
| `receivedAt`  | ISO 8601 date-time                                                                           | With offset or `Z`.                                                                           |
| `sender`      | `{ name?, address? }`                                                                        | Teams gives a name only; neither field is required on its own.                                |
| `recipients`  | `[{ name?, address?, role? }]`                                                               | `role`: `to`, `cc`, `bcc`.                                                                    |
| `subject`     | string                                                                                       | Email subject, or the Teams chat/channel name. May be empty.                                  |
| `body`        | `{ text, format? }`                                                                          | `format`: `text` (default) or `html`.                                                         |
| `thread`      | `{ conversationId?, parentId? }`                                                             |                                                                                               |
| `context`     | `{ origin?, tenantId?, chatId?, chatType?, teamName?, channelName?, mailbox?, importance? }` | See Teams below. `origin` (`teams`, `outlook`, `manual`) is set by Paste only; informational. |
| `attachments` | `[{ name?, contentType?, size?, ref? }]`                                                     | References only; the app never opens them.                                                    |
| `link`        | string                                                                                       | Teams message deep link, or `outlook:<EntryID>`.                                              |

## De-duplication

`dedupeKey = source + ":" + sha256(sourceId)`. If `sourceId` is blank, the key
falls back to `sha256(source | sender | receivedAt | first 500 normalised body
characters)`. A message whose key has already produced a proposal is deleted
from the inbox and logged as a duplicate, so dropping the same file twice (or a
flow that fires twice) yields one item.

`sourceId` for Teams: the message id (the id inside the trigger's message
payload, `messagePayload.id`; confirmed present in your tenant). If a flow cannot
get it, derive it from the deep link (the last path segment of
`/l/message/<chat>/<messageId>`).

`sourceId` for Outlook: the Internet Message-ID (`<...@...>`, stable when a mail
moves folders), and only if a message has none, its EntryID. The Outlook script
and the flagged-email flow use different ids for the same mail (the flow's
`body/id` is a Graph id), so a mail exported by both is not recognised as one;
use one of the two for Outlook mail.

`sourceId` for a paste: `manual-` plus a hash of the normalised subject, From and
text, so pasting the same message twice (whatever its case or spacing) is one
item, and the Paste dialog says so instead of writing a second file.

## The Deloitte-only filter

Decided from metadata alone, before anything is stored or sent to the local
model. First rule that rejects wins. A rejected item is **quarantined**
(metadata and the reason only; its text is not kept) and shown under the
**Filtered** tab, so nothing vanishes silently.

1. Any sender or recipient address whose domain is in `blockedDomains`
   (default `takeda.com`; subdomains match) is quarantined.
2. Any `blockedTerms` entry (default none) found in subject or body.
3. `source: "teams"` is **default-deny**: it passes only if its tenant ID is in
   `allowedTenantIds` or its chat ID is in `teamsChatAllowlist`. Both lists
   ship empty, so until you add your tenant, every Teams item is filtered. The
   app says so in its status bar. The tenant and chat IDs are read from
   `context.tenantId` / `context.chatId`, or, when the flow cannot supply them,
   from the Teams deep link in `link` (`...?tenantId=<guid>` and the chat id in
   the path).
4. `source: "outlook"` needs a sender domain in `allowedSenderDomains`
   (default `deloitte.com`; subdomains match). No readable sender address means
   quarantined.
5. `source: "manual"` (pasted by you) only goes through rules 1 and 2, with one
   addition to rule 1: because a paste has no reliable From/To, **any e-mail
   address found inside the pasted subject or text** whose domain is blocked also
   quarantines it (a pasted mail usually carries its whole header block). The
   **Teams default-deny does not apply to a paste, whatever it says about its
   origin**: you vouch for what you paste yourself. This is a deliberate choice
   (it is how a Teams message can be brought in before the tenant is
   allowlisted); the blocked domains and terms are still enforced. Both halves
   are covered by tests (`pmo.test.mjs`, `pmo.server.test.mjs`).

### Allowing your Teams tenant

Either use **Allow this tenant** on a filtered Teams item in the app, or open
**Settings** (the gear in the app's top bar) and put the GUID under _Allowed
Teams tenant IDs_, or edit `config.json` in the PMO data folder
(`%LOCALAPPDATA%\AI OS\pmo` in development; `<AI OS user data>\pmo` in the
desktop app) and add the GUID:

```json
{ "allowedTenantIds": ["00000000-0000-0000-0000-000000000000"] }
```

Where to find the tenant ID: the Teams flow's trigger output (run history, the
run, the trigger card, the `tenantId` value), or `?tenantId=` in any Teams
message link.

### Filtered items cannot be "moved to review"

A filtered item keeps its metadata and reason only; **its text is deleted when it
is filtered** (so nothing the filter was meant to keep out is stored). That means
it can never be turned into a proposal afterwards. The Filtered tab says so, and
offers what is possible: one click to allow the tenant or the sender's domain,
then **send the message again** (Teams: run the flow on it again; Outlook: flag
it again, or run the script with `-IgnoreSeen`; a paste: paste it again). The
same message, once it passes, also clears its old Filtered entry.

## Retention

A purge runs when the app's server starts and then daily (idempotent). With
`retentionDays` in `config.json` (default **90**, 7 to 3650, editable in
Settings):

| What                                             | Deleted when                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `logs/ingest.jsonl`, `logs/ai-calls.jsonl` lines | older than `retentionDays`                                                                                   |
| `raw/<id>.json` (the saved message text)         | its to-do is done or cancelled, or its proposal was rejected, **and** that was more than `retentionDays` ago |
| `quarantine/` records, `rejected-files/`         | older than 30 days (or `retentionDays` if that is smaller)                                                   |

Never deleted: the raw text of an **open** to-do (even years old) or of a proposal
nobody has decided yet; the proposal and to-do records themselves; `audit.jsonl`;
`state/seen.json` (hashes only, which is what keeps a purged message from being
imported again as new); `config.json`.

## What the app does with a file

1. Parse and validate. On failure the file is left for 2 more scans, then moved
   to `rejected-files/` with a `.reason.txt`.
2. De-duplicate (above).
3. Filter (above).
4. Pass: store an immutable copy under `raw/`, create a **pending proposal**,
   delete the inbox file. The local model then structures it; **a human
   Approve** is the only thing that creates a to-do.

The app sends nothing anywhere in phase 1: no email, no Teams message, no
network call other than the local Ollama on `127.0.0.1`.

## The Outlook script (`producer: "outlook-com"`)

[`scripts/Export-OutlookToInbox.ps1`](./scripts/Export-OutlookToInbox.ps1) reads
**classic** Outlook through COM and writes one file per mail. ("New Outlook" has
no COM support; the script detects it and says so.) It is **read-only**: it
never sends, deletes, moves, copies, saves or displays a mail, never sets a
category, flag or read-state, and never opens or saves an attachment (name, size
and type only). A test fails the build if any of those calls appear in the script
text, and the mapping is tested with fake items, without Outlook.

| Parameter             | Default                                             | Meaning                                                                                                                       |
| --------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-InboxDir`           | `C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox` | Drop folder. Must exist; never created.                                                                                       |
| `-FolderPath`         | (none: flagged mail)                                | e.g. `Inbox\PMO`. Without it, every **flagged** mail in the default mailbox (the To-Do search folder), by last-modified time. |
| `-SinceDays`          | 14                                                  | Window: received in the last N days (folder), or modified in the last N days (flagged).                                       |
| `-StatePath`          | `%LOCALAPPDATA%\AI OS\pmo-intake\outlook-seen.json` | Its own seen-file, keyed by Message-ID (EntryID if none).                                                                     |
| `-MaxItems`           | 200                                                 | Most files per run, newest first.                                                                                             |
| `-DryRun` / `-WhatIf` | off                                                 | Print what would be written; write nothing, not even the seen-file.                                                           |
| `-IgnoreSeen`         | off                                                 | Export again even if the seen-file says so (after allowing a domain).                                                         |

Mapping: `sourceId` = Message-ID (else EntryID); `receivedAt` ISO 8601 with the
local offset; `sender` name plus **SMTP** address (Exchange senders come back
from Outlook as X500 distinguished names, which are resolved through
`GetExchangeUser().PrimarySmtpAddress` and the MAPI SMTP properties; if none
resolves the address is left out and the filter quarantines the mail with
"no readable sender address"; an X500 string is never written as an address);
`recipients` To and Cc (not Bcc); `body.text` the plain text, or the HTML turned
into text; `thread.conversationId`; `attachments` metadata only; `link`
`outlook:<EntryID>`; `context.mailbox`, `context.importance`. Anything that is
not a plain mail (meeting requests, reports, tasks) is skipped and reported.
Dates in the Outlook `Restrict` filter are formatted with the invariant culture
(DASL `yyyy-MM-dd HH:mm`, then the US Jet form as a second try, then a
newest-first scan), widened by a day, and every item's real time is re-checked in
code, so the machine's regional settings cannot change what is exported.

### Task Scheduler (documented only; nothing here has been registered)

Run it by hand first (`-DryRun`, then for real). To run it every 15 minutes while
you are signed in, from a normal (not elevated) PowerShell:

```powershell
$script    = 'C:\Projects\AI OS\pmo-intake\scripts\Export-OutlookToInbox.ps1'
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -SinceDays 3' -f $script
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger   = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(8) `
             -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
             -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'PMO Outlook export' -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings `
  -Description 'Read-only export of flagged Outlook mail to the PMO inbox'

# Remove it again:
# Unregister-ScheduledTask -TaskName 'PMO Outlook export' -Confirm:$false
```

Notes: `Interactive` means it only runs while you are signed in (Outlook COM needs
your session); do **not** run it elevated, because COM refuses to cross an
elevation boundary; the script appends one line per run to
`%LOCALAPPDATA%\AI OS\pmo-intake\outlook-export.log`; and if Outlook shows its
"a program is trying to access email address information" prompt, a hidden run
cannot answer it (the script stops after three denials and logs why).

## Versioning

Breaking changes get a new `schema` string (`pmo-intake/2`). Unknown extra
fields are ignored, so producers may add their own.
