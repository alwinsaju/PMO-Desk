# Power Automate recipes for the PMO inbox

Two cloud flows that each turn one message into one `pmo-intake/1` JSON file in
your OneDrive folder `PMO-Inbox` (see [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md)).
OneDrive syncs the folder to `C:\Users\alsaju\OneDrive - Deloitte\PMO-Inbox`,
where the PMO To-Do app picks the files up.

- **Recipe A**: Outlook, when you flag an email.
- **Recipe B**: Teams, when you pick "your flow" from a message's **...** menu.

Both flows use **standard connectors only**: Office 365 Outlook, Microsoft
Teams, OneDrive for Business, and the built-in _Data operation_ actions
(Compose, Select). None of them shows a "Premium" badge; if a card in your
flow does, you picked a different action than the one named here. **Neither
flow sends anything**: no email, no Teams post, no approval. Their only output
is one file. (Microsoft's Teams guidance suggests posting a confirmation back;
we deliberately do not.)

Before you start, create the folder: OneDrive web or File Explorer, make
`PMO-Inbox` in the root of your OneDrive for Business. Keep it empty; the app
deletes each file after it has dealt with it.

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

### What the trigger gives us, and what we cannot confirm

Microsoft documents these trigger outputs: the message content (full HTML), a
plain-text version, a link to the message, the sender's display name and ID,
and the originating user's display name and ID. From what you observed in your
own flow, it also exposes the tenant ID and a payload object containing the
message id.

What it does **not** give (so the intake leaves them out or optional):

- a plain **chat id** (the id is only inside the deep link),
- the sender's **email address** (display name and an ID only),
- the **chat / channel name** (we use a generic subject).

What we cannot confirm from documentation: the **exact output property names**.
The Teams connector reference does not list this trigger's outputs. The table
below gives the names most likely to be right; treat them as **unconfirmed**.
Insert each field with the **dynamic-content picker** wherever you can (it
shows the real names), and do the capture step below once before trusting any
expression.

| Intake field       | Source in the trigger                                                        | Status                                               |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `source`           | constant `teams`                                                             | n/a                                                  |
| `sourceId`         | message id inside the message payload (`messagePayload` -> `id`)             | name unconfirmed; fallback: last segment of the link |
| `receivedAt`       | payload created time (`messagePayload` -> `createdDateTime`)                 | name unconfirmed; fallback `utcNow()`                |
| `sender.name`      | picker: _Sender display name_ (or payload `from` -> `user` -> `displayName`) | name unconfirmed                                     |
| `sender.address`   | not available; leave out                                                     | n/a                                                  |
| `subject`          | not available; use a constant such as `Teams message`                        | n/a                                                  |
| `body.text`        | picker: _Plain text message_; else _Message content_ with `format` `html`    | documented in prose, name unconfirmed                |
| `context.tenantId` | picker: _Tenant Id_ (`tenantId`)                                             | seen in your flow                                    |
| `context.chatId`   | not available; the app reads it from the link                                | n/a                                                  |
| `link`             | picker: _Link to message_ (`LinkToMessage`)                                  | seen in your flow                                    |

### Capture one raw trigger output first

1. Create the flow (steps below) with only the trigger and one **Compose**
   named `Raw` whose input is the expression `triggerOutputs()`.
2. In Teams, open a **test** chat (a chat with yourself works), hover a message
   -> **...** -> **More actions** -> your flow (named by the flow name) ->
   **Run**.
3. Power Automate -> **My flows** -> the flow -> **28-day run history** -> the
   run -> open the _Raw_ card -> **Outputs**. Copy the JSON.
4. Look for the real names: the message id, created time, sender display name,
   body (HTML and text), the link, the tenant id. Use those names in the
   expressions below. If you paste the raw output into the PMO To-Do repo as a
   fixture, remove real names and text first.

### 1. Create the flow

1. <https://make.powerautomate.com> -> make sure the environment (top right) is
   **your default environment** -> **Create** -> **Instant cloud flow**.
2. **Flow name**: `Send to PMO To-Do` (this name is what you will click in
   Teams, so keep it short and clear).
3. Trigger: **For a selected message** (Microsoft Teams) -> **Create**.
   Do not add the adaptive-card input; we do not need it.

### 2. Compose the intake

1. **+** -> **Compose**, rename `Intake`.
2. Inputs: the object below. Replace each `<picker: ...>` by choosing that field
   in the dynamic-content panel, or by the expression you confirmed in the
   capture step. The skeleton uses the likely expressions.

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

If the trigger offers a plain-text output, prefer it: put it in `body.text` and
set `"format": "text"`. Keep `receivedAt` as an ISO date-time. If the payload's
created time is missing, `utcNow()` stands in (the message's age is lost, but
nothing else is).

`sourceId` falls back to the last path segment of the deep link
(`.../l/message/<chat>/<messageId>?...`), which is the message id, so the same
message selected twice is de-duplicated either way.

### 3. Write the file

Identical to Recipe A step 5, with the file name
`concat('teams-', guid(), '.json')` and content `string(outputs('Intake'))`.

### 4. Allow your tenant in the app

Until your tenant is allowlisted the app **filters every Teams item** (it is
default-deny, and says so in its status bar). After your first test run, the
item appears under **Filtered** with your tenant GUID and an **Allow this
tenant** button. Click it, then run the flow on that message again. (Or put the
GUID in `allowedTenantIds` in the app's `config.json`; see the contract.)

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
- [ ] The file lands in `PMO-Inbox` and, within ~30 seconds of syncing, in the
      app's Review Queue (or under Filtered with a reason).
- [ ] Nothing client-related is flagged or selected while you are testing.
