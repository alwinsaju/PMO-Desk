# PMO intake contract: `pmo-intake/1`

The PMO To-Do app does not read your mailbox or Teams. A **producer** (a Power
Automate cloud flow today, an Outlook COM script later) writes one JSON file per
message into a folder, and the app picks the files up. This document is the
whole interface between the two.

- Machine-readable schema: [`intake.v1.schema.json`](./intake.v1.schema.json)
- Examples: [`examples/`](./examples)
- Click-by-click flow recipes: [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md)
- Sample writer for testing: [`scripts/New-SampleIntake.ps1`](./scripts/New-SampleIntake.ps1)

## Where files go

| Setting      | Default                                         | Override                                                  |
| ------------ | ----------------------------------------------- | --------------------------------------------------------- |
| Inbox folder | `C:\Users\alsaju\OneDrive - Deloitte\PMO-Inbox` | env `AI_OS_PMO_INBOX_DIR`, or `inboxDir` in `config.json` |

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
   duplicate, filtered). It never writes into the folder.

## Fields

Required: `schema`, `source`, `sourceId`, `receivedAt`, `sender`, `subject`,
`body.text`. Everything else is optional. `null` counts as "not provided".

| Field         | Type                                                                                | Notes                                                                   |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `schema`      | `"pmo-intake/1"`                                                                    | Exactly this string.                                                    |
| `producer`    | string                                                                              | `pa-cloud-flow`, `outlook-com`, `manual-paste`, `other`. Informational. |
| `source`      | `"outlook"` \| `"teams"` \| `"manual"`                                              | Drives the filter rules below.                                          |
| `sourceId`    | string                                                                              | Stable id of the message in its system; the de-duplication key.         |
| `receivedAt`  | ISO 8601 date-time                                                                  | With offset or `Z`.                                                     |
| `sender`      | `{ name?, address? }`                                                               | Teams gives a name only; neither field is required on its own.          |
| `recipients`  | `[{ name?, address?, role? }]`                                                      | `role`: `to`, `cc`, `bcc`.                                              |
| `subject`     | string                                                                              | Email subject, or the Teams chat/channel name. May be empty.            |
| `body`        | `{ text, format? }`                                                                 | `format`: `text` (default) or `html`.                                   |
| `thread`      | `{ conversationId?, parentId? }`                                                    |                                                                         |
| `context`     | `{ tenantId?, chatId?, chatType?, teamName?, channelName?, mailbox?, importance? }` | See Teams below.                                                        |
| `attachments` | `[{ name?, contentType?, size?, ref? }]`                                            | References only; the app never opens them.                              |
| `link`        | string                                                                              | Teams message deep link, or `outlook:<EntryID>`.                        |

## De-duplication

`dedupeKey = source + ":" + sha256(sourceId)`. If `sourceId` is blank, the key
falls back to `sha256(source | sender | receivedAt | first 500 normalised body
characters)`. A message whose key has already produced a proposal is deleted
from the inbox and logged as a duplicate, so dropping the same file twice (or a
flow that fires twice) yields one item.

`sourceId` for Teams: the message id (the id inside the trigger's message
payload). If a flow cannot get it, derive it from the deep link (the last path
segment of `/l/message/<chat>/<messageId>`).

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
5. `source: "manual"` (typed or pasted by you) only goes through rules 1 and 2.

### Allowing your Teams tenant

Either use **Allow this tenant** on a filtered Teams item in the app, or edit
`config.json` in the PMO data folder (`%LOCALAPPDATA%\AI OS\pmo` in
development; `<AI OS user data>\pmo` in the desktop app) and add the GUID:

```json
{ "allowedTenantIds": ["00000000-0000-0000-0000-000000000000"] }
```

Quarantined items are not re-processed; send the message again from Teams after
allowing the tenant. (The same message, once it passes, also clears its old
Filtered entry.)

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

## Versioning

Breaking changes get a new `schema` string (`pmo-intake/2`). Unknown extra
fields are ignored, so producers may add their own.
