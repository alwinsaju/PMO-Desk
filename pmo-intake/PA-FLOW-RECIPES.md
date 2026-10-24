# Power Automate recipes for the PMO inbox

Two cloud flows that each turn one message into one `pmo-intake/1` JSON file in
your OneDrive folder `PMO-Inbox` (see [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md)).
OneDrive syncs the folder to `C:\Users\alsaju\OneDrive - Deloitte\PMO-Inbox`,
where the PMO To-Do app picks the files up. For the whole set-up in order, start
with [`HOW-TO-GET-STARTED.md`](./HOW-TO-GET-STARTED.md).

- **Recipe A**: Outlook, when you flag an email.
- **Recipe B**: Teams, when you pick "your flow" from a message's **...** menu.

(Two more ways in need no flow: the **Paste** button in the app, and the Outlook
script [`scripts/Export-OutlookToInbox.ps1`](./scripts/Export-OutlookToInbox.ps1).)

Both flows use **standard connectors only**: Office 365 Outlook, Microsoft
Teams, OneDrive for Business, and the built-in _Data operation_ actions
(Compose, Select). None of them shows a "Premium" badge; if a card in your
flow does, you picked a different action than the one named here. **Neither
flow sends anything**: no email, no Teams post, no approval. Their only output
is one file. (Microsoft's Teams guidance suggests posting a confirmation back;
we deliberately do not.)

### What you have already confirmed in your own tenant

| Thing                                                                                                   | Result                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cloud flows (no premium licence)                                                                        | work                                                               |
| OneDrive for Business **Create file**                                                                   | standard connector; the file reaches the laptop in about 2 seconds |
| Outlook **When an email is flagged (V3)**                                                               | triggers                                                           |
| Teams **For a selected message**                                                                        | triggers                                                           |
| Teams trigger output: **tenant id**, **LinkToMessage**, **messagePayload** (it contains the message id) | present                                                            |
| Teams trigger output: a plain **chat id**, the sender's **email address**                               | **not present**                                                    |

Everything below follows from that table. Names of fields **inside**
`messagePayload` (the message body, the sender's display name, the created
time) are **not confirmed**: that is what the capture step in Recipe B is for.

Before you start, create two folders in the root of your OneDrive for Business:

- `PMO-Inbox`: the real drop folder. Keep it empty; the app deletes each file
  after it has dealt with it.
- `PMO-Debug`: for raw captures while you build a flow. **The app never watches
  it, and nothing you put there reaches the queue.** Delete the files when you
  are done.

> **Test with a temp folder first.** While you are building a flow, point its
> _Create file_ action at a folder like `/PMO-Inbox-test`, and only switch it to
> `/PMO-Inbox` when the files look right. The app only watches `PMO-Inbox`.

---

## Why Compose, and how the body gets escaped safely

An email body is full of quotes, backslashes and line breaks. If you paste a
token into the middle of hand-typed JSON _text_, the first `"` in the body
breaks the file. The recipes avoid that: the intake is a Compose whose input is
a JSON **object**, with each token as the entire value of a field. Power
Automate puts the value into the object _before_ turning it into text, and
escapes it on the way. The step that writes the file uses `string(...)` of that
object.

If you ever need to build the JSON as text instead (with `json()` or
`concat()`), never splice a raw token in. Escape it first with this trick, which
returns the value as a quoted, escaped JSON string:

```
substring(string(createArray(<value>)), 1, sub(length(string(createArray(<value>))), 2))
```

and wrap the result in `json(...)` only at the very end, which makes a
malformed result fail the run (visible in run history) instead of writing a bad
file.

---

## Recipe A: Outlook, "When an email is flagged (V3)" -> OneDrive file

### 1. Create the flow

1. Go to <https://make.powerautomate.com>, sign in with your Deloitte account.
2. Left menu **Create** -> **Automated cloud flow**.
3. **Flow name**: `PMO intake - flagged email`.
4. In _Choose your flow's trigger_ search `flagged`, pick **When an email is
   flagged (V3)** (Office 365 Outlook). A **V4** variant may be offered; it is
   also standard and exposes the same fields under the same names, use it if
   V3 is missing. -> **Create**.
5. Click the trigger card. **Folder**: `Inbox`. Leave the other fields empty.
   (Flag an email in Outlook = star/flag icon; only flagged mail is picked up,
   so _you_ decide what enters the system.)

### 2. Compose the body text

1. **+** under the trigger -> search `Compose` -> **Compose** (Data operation).
2. Rename it (card title -> `...` -> Rename) to `BodyText`.
3. **Inputs**: click the _Expression_ tab (fx) and enter
   `coalesce(triggerOutputs()?['body/body'], '')` -> **Add**.

### 3. Build the recipients (To and Cc)

The trigger gives To and Cc as semicolon-separated address strings. The intake
wants objects, and the filter needs them to catch a blocked domain.

1. **+** -> **Select** (Data operation). Rename `Select_To`.
   - **From** (expression): `split(coalesce(triggerOutputs()?['body/to'], ''), ';')`
   - **Map**: switch to the text-mode map (the `T` icon at the right of the Map
     field) and enter:
     `{ "address": "@{trim(item())}", "role": "to" }`
2. Another **Select**, rename `Select_Cc`: same, with `body/cc` and `"role": "cc"`.

(An empty To/Cc leaves one entry with an empty address; the app ignores it.)

### 4. Compose the intake

1. **+** -> **Compose**, rename `Intake`.
2. Click in **Inputs**, then paste exactly this and let the designer keep it as
   an object (the `@{...}` / `@...` parts are expressions the designer evaluates
   at run time; if it turns them into plain text, use the three-dot menu ->
   _Peek code_/_Edit in code view_ and paste it into the `inputs` property):

```json
{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "outlook",
  "sourceId": "@{triggerOutputs()?['body/id']}",
  "receivedAt": "@{triggerOutputs()?['body/receivedDateTime']}",
  "sender": {
    "name": "@{triggerOutputs()?['body/from']}",
    "address": "@{triggerOutputs()?['body/from']}"
  },
  "recipients": "@union(body('Select_To'), body('Select_Cc'))",
  "subject": "@{coalesce(triggerOutputs()?['body/subject'], '')}",
  "body": {
    "text": "@{outputs('BodyText')}",
    "format": "@{if(equals(triggerOutputs()?['body/isHtml'], true), 'html', 'text')}"
  },
  "thread": {
    "conversationId": "@{triggerOutputs()?['body/conversationId']}"
  },
  "context": {
    "mailbox": "@{triggerOutputs()?['body/toRecipients']}",
    "importance": "@{triggerOutputs()?['body/importance']}"
  },
  "attachments": [],
  "link": "@{concat('outlook:', triggerOutputs()?['body/id'])}"
}
```

Notes on the fields (all names are those of the Office 365 Outlook trigger; the
dynamic-content picker shows them as _Message Id_, _Received Time_, _From_,
_To_, _Cc_, _Subject_, _Body_, _Is HTML_, _Conversation Id_, _Importance_):

- `From` is just an address in this trigger, so `sender.name` repeats it. The
  filter needs the address; the name is cosmetic.
- `context.mailbox` is optional; delete that line if `body/toRecipients` is not
  offered in your tenant.
- Attachments are left empty on purpose (the app only stores references and
  never opens them). Do not put attachment _content_ in the file.
- If a dynamic-content name differs in your tenant, delete that expression and
  insert the field from the picker instead of typing it.

### 5. Write the file

1. **+** -> search `Create file` -> **Create file** (**OneDrive for Business**).
2. **Folder Path**: click the folder icon, pick `PMO-Inbox` (or
   `PMO-Inbox-test` while testing).
3. **File Name** (expression):
   `concat('outlook-', guid(), '.json')`. The name only has to be unique; the
   app de-duplicates on `sourceId`, not on the name.
4. **File Content** (expression): `string(outputs('Intake'))`.
5. **Write-then-rename:** the app only reads `*.json`, so the ideal is to create
   `outlook-<guid>.tmp` and then rename it. If your OneDrive for Business
   connector offers a **Rename file** action (search `rename`), do that: use
   `.tmp` as the extension in _Create file_, then add _Rename file_ with the
   _Id_ from _Create file_ and a new name ending `.json`. If it does not offer
   one, skip this: the connector uploads the whole file in one call, the
   OneDrive sync client hands it to Windows complete, and the app ignores any
   file modified in the last 3 seconds and retries unparsable files on 3 scans
   before parking them. Nothing is lost either way.

### 6. Save and test

1. **Save** (top right). Open **Flow checker**: it should show no errors.
2. In Outlook, flag one test email (a fictional or your own non-client mail).
3. In Power Automate -> **My flows** -> the flow -> **28-day run history**: the
   run should show green ticks within a minute (the trigger polls; it is not
   instant). Open the run and look at _Intake_: the `body.text` must contain
   the email, with line breaks shown as `\n`.
4. The file appears in `PMO-Inbox` (OneDrive sync can take a minute) and then
   in the app's Review Queue.

---

## Recipe B: Teams, "For a selected message" -> OneDrive file

### Limits of this trigger (from Microsoft's documentation)

- You must create the flow in your **default environment** or it will not show
  up in Teams.
- Only the **flow author** can run it (that is you; fine here).
- It needs the **Power Automate Actions** app unblocked in the Teams admin
  center (App ID `00001016-de05-492e-9106-4828fc8a8687`). If the flow never
  appears under a message's **...** -> _More actions_, ask your Teams admin.
- It does not work for guest or external users in a team, and is not available
  in sovereign clouds.

### What the trigger gives us

Confirmed in your tenant (see the table at the top):

| Intake field       | Source in the trigger                                                                  | Status                                            |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `source`           | constant `teams`                                                                       | n/a                                               |
| `context.tenantId` | picker: _Tenant Id_ (`triggerBody()?['tenantId']`)                                     | **confirmed** (present in the output)             |
| `link`             | picker: _Link to message_ (`LinkToMessage`)                                            | **confirmed**                                     |
| `sourceId`         | message id: `messagePayload` -> `id`                                                   | **confirmed**; fallback: last segment of the link |
| `receivedAt`       | created time inside `messagePayload` (likely `createdDateTime`)                        | **unconfirmed**; fallback `utcNow()`              |
| `sender.name`      | sender display name inside `messagePayload` (likely `from` -> `user` -> `displayName`) | **unconfirmed**                                   |
| `body.text`        | message content inside `messagePayload` (likely `body` -> `content`, HTML)             | **unconfirmed**                                   |
| `sender.address`   | not available in this trigger; leave it out                                            | n/a                                               |
| `context.chatId`   | not available as a field; the app reads it from the link                               | n/a                                               |
| `subject`          | not available; use a constant such as `Teams message`                                  | n/a                                               |

Microsoft's own page describes outputs such as the message content, a plain-text
version, the sender's display name and id, but the Teams connector reference
does not list this trigger's exact property names, so the "likely" names above
are guesses from the Graph message shape. **Do not rely on any unconfirmed name
until you have captured one real output (next section).** Until the body path is
right, a flow writes an empty `body.text`, which would flood the queue with
empty items, so keep the flow pointed at `PMO-Inbox-test` until a captured file
shows the message in the field you used.

The tenant ID is what lets a Teams item through the filter (Teams is
default-deny until a tenant or chat is allowlisted): it comes from
`context.tenantId`, or, if that is empty, from `?tenantId=` in the link.

### Capture one raw trigger output first (do this once)

The goal is to see the real field names. This capture writes the **whole**
trigger output to a file in `/PMO-Debug`, **never** to `/PMO-Inbox`, so it
cannot reach the queue.

1. Create the flow (steps below) with only the trigger and these two actions:
   1. **Compose**, rename `Raw`. Click in **Inputs**, open the _Expression_ tab
      (fx), paste this and press **Add**:
      ```
      string(triggerOutputs())
      ```
   2. **Create file** (OneDrive for Business):
      - **Folder Path**: `/PMO-Debug` (pick it with the folder icon)
      - **File Name** (expression): `concat('teams-raw-', utcNow('yyyyMMddTHHmmss'), '.json')`
      - **File Content**: pick `Outputs` of the `Raw` step from the dynamic
        content panel (or expression `outputs('Raw')`).
2. In Teams, open a **test** chat (a chat with yourself works), type a message
   such as `Test: please send the RAID log to Pat by Friday`, hover it ->
   **...** -> **More actions** -> your flow -> **Run**.
3. Open `PMO-Debug` in OneDrive (or File Explorer), open the new
   `teams-raw-....json` in a text editor (VS Code, or Notepad then Format ->
   Word wrap). You can also copy it from Power Automate -> **My flows** -> the
   flow -> **28-day run history** -> the run -> the _Raw_ card -> **Outputs**.
4. Find, inside `messagePayload`: the message id (confirmed), the created time,
   the sender's display name, the body (HTML and/or text), and the top-level
   `tenantId` and `LinkToMessage`. Write down the real property names.
5. Use those names in the expressions in "Compose the intake" below.
6. **Delete the capture file** from `PMO-Debug` (and the _Raw_ steps once you
   are done). The file can include request headers and your real message text:
   do not share it, and do not commit it anywhere. If you want a fixture in the
   PMO To-Do repo, replace names, ids and text with fictional values first.

### 1. Create the flow

1. <https://make.powerautomate.com> -> make sure the environment (top right) is
   **your default environment** -> **Create** -> **Instant cloud flow**.
2. **Flow name**: `Send to PMO To-Do` (this name is what you will click in
   Teams, so keep it short and clear).
3. Trigger: **For a selected message** (Microsoft Teams) -> **Create**.
   Do not add the adaptive-card input; we do not need it.

### 2. Compose the intake

1. **+** -> **Compose**, rename `Intake`.
2. Inputs: the object below. The `tenantId`, `LinkToMessage` and
   `messagePayload.id` expressions are confirmed. Replace the paths marked
   `UNCONFIRMED` with the names you found in the capture (or choose the field
   in the dynamic-content panel).

```json
{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "teams",
  "sourceId": "@{coalesce(triggerBody()?['messagePayload']?['id'], last(split(first(split(triggerBody()?['LinkToMessage'], '?')), '/')))}",
  "receivedAt": "@{coalesce(triggerBody()?['messagePayload']?['createdDateTime'], utcNow())}",
  "sender": {
    "name": "@{triggerBody()?['messagePayload']?['from']?['user']?['displayName']}"
  },
  "subject": "Teams message",
  "body": {
    "text": "@{coalesce(triggerBody()?['messagePayload']?['body']?['content'], '')}",
    "format": "html"
  },
  "context": {
    "tenantId": "@{triggerBody()?['tenantId']}"
  },
  "attachments": [],
  "link": "@{triggerBody()?['LinkToMessage']}"
}
```

`UNCONFIRMED` paths in this object: `receivedAt` (`createdDateTime`),
`sender.name` (`from.user.displayName`), `body.text` (`body.content`). If the
capture shows a plain-text version of the message, prefer it for `body.text` and
set `"format": "text"`. Keep `receivedAt` an ISO date-time; if the created time
is missing, `utcNow()` stands in (the message's age is lost, nothing else is).

`sourceId` is the message id, falling back to the last path segment of the deep
link (`.../l/message/<chat>/<messageId>?...`), so the same message selected
twice is de-duplicated either way.

### 3. Write the file

Identical to Recipe A step 5, with the file name
`concat('teams-', guid(), '.json')` and content `string(outputs('Intake'))`.
Use `/PMO-Inbox-test` until a test file in it looks right (the message text is in
`body.text`, the tenant GUID is in `context.tenantId`), then switch to
`/PMO-Inbox`. Remove the capture steps (_Raw_ and its _Create file_) from the
final flow.

### 4. Allow your tenant in the app

Until your tenant is allowlisted the app **filters every Teams item** (it is
default-deny, and says so in its status bar). Either:

- open the app's **Settings** (gear icon), paste the tenant GUID from the
  capture (`tenantId`) under _Allowed Teams tenant IDs_, **Save**; or
- run the flow on a test message once; the item appears under **Filtered** with
  the tenant GUID and an **Allow this tenant** button.

Then run the flow on the message again (a filtered message's text is discarded
by design, so it cannot be moved into the queue; it has to be sent again).

### 5. Save and test

Save, run it from a message in a test chat, check the run history for green
ticks, then look in OneDrive and in the app. Remember that nobody gets a reply:
the only evidence the flow ran is the run history and the file.

---

## Checklist before you trust either flow

- [ ] Flow checker shows no errors and no card carries a Premium badge.
- [ ] Run history shows `body.text` with real line breaks as `\n` (not a failed
      run on a message that contained quotes).
- [ ] The only actions are: trigger, Compose/Select, Create file (and optional
      Rename file). No send, post, approve, HTTP or mail action.
- [ ] The Teams flow no longer contains the capture steps, and `PMO-Debug` has
      been emptied.
- [ ] The file lands in `PMO-Inbox` and, within ~30 seconds of syncing, in the
      app's Review Queue (or under Filtered with a reason).
- [ ] Nothing client-related is flagged or selected while you are testing.
