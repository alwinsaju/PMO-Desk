# Power Automate recipes for the PMO inbox

Two cloud flows that each turn one message into one `pmo-intake/1` JSON file in
your OneDrive folder `PMO-Inbox` (see [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md)).
OneDrive syncs the folder to `C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox`,
where the PMO To-Do app picks the files up. For the whole set-up in order, start
with [`HOW-TO-GET-STARTED.md`](./HOW-TO-GET-STARTED.md).

- **Recipe A**: Outlook, when you flag an email.
- **Recipe B**: Teams, when you pick "your flow" from a message's **...** menu
  (trigger **For a selected message (V2)**).

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

| Thing                                                                | Result                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cloud flows (no premium licence)                                     | work                                                                                                     |
| OneDrive for Business **Create file**                                | standard connector; the file reaches the laptop in about 2 seconds                                       |
| Outlook **When an email is flagged (V3)**                            | triggers                                                                                                 |
| Teams **For a selected message (V2)**                                | triggers; a real capture of its output gives every field Recipe B uses, **including the tenant id**      |
| Teams trigger: sender email address, created-time field              | **not present** (the created time is derived from the message id; the sender is a display name only)    |

Everything below follows from that table. The exact Teams property paths are
listed in Recipe B.

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
5. Click the trigger card. You do not need to set anything: leave all fields
   empty. The **Folder** parameter (key `folderPath`) is optional and hidden under
   **Advanced parameters** in the new designer; with it unset the trigger watches
   the Inbox. If you want a specific folder instead, click **Advanced
   parameters**, tick **Folder**, and pick the folder. (Flag an email in Outlook =
   star/flag icon; only flagged mail is picked up, so _you_ decide what enters the
   system.)

   The field names in this recipe were checked against Microsoft's Office 365
   Outlook connector reference (schema `GraphClientReceiveMessage`: `id`,
   `internetMessageId`, `conversationId`, `receivedDateTime`, `from`,
   `toRecipients`, `ccRecipients`, `subject`, `body`, `bodyPreview`, `importance`
   as low/normal/high, `hasAttachments`, `isHtml`, `attachments`). The trigger
   fires again if an already-flagged email is modified; the app dedupes on the
   message id, so that is harmless.

### 2. Compose the body text

1. **+** under the trigger -> search `Compose` -> **Compose** (Data operation).
2. Rename it (card title -> `...` -> Rename) to `BodyText`.
3. **Inputs**: click the _Expression_ tab (fx) and enter
   `coalesce(triggerOutputs()?['body/body'], '')` -> **Add**.

### 3. Build the recipients (To and Cc)

The trigger gives To and Cc as semicolon-separated address strings. The intake
wants objects, and the filter needs them to catch a blocked domain.

1. **+** -> **Select** (Data operation). Rename `Select_To`.
   - **From** (expression): `split(coalesce(triggerOutputs()?['body/toRecipients'], ''), ';')`
   - **Map**: switch to the text-mode map (the `T` icon at the right of the Map
     field) and enter:
     `{ "address": "@{trim(item())}", "role": "to" }`
2. Another **Select**, rename `Select_Cc`: same, with **From** (expression)
   `split(coalesce(triggerOutputs()?['body/ccRecipients'], ''), ';')` and
   `"role": "cc"` in the Map.

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
- `context.mailbox` is optional and informational. It holds the To-recipients
  string (`body/toRecipients`), not a mailbox address; delete that line if
  `body/toRecipients` is not offered in your tenant.
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

## Recipe B: Teams, "For a selected message (V2)" -> OneDrive file

### Limits of this trigger (from Microsoft's documentation)

- You must create the flow in your **default environment** or it will not show
  up in Teams.
- Only the **flow author** can run it (that is you; fine here).
- It needs the **Power Automate Actions** app unblocked in the Teams admin
  center (App ID `00001016-de05-492e-9106-4828fc8a8687`). If the flow never
  appears under a message's **...** -> _More actions_, ask your Teams admin.
- It does not work for guest or external users in a team, and is not available
  in sovereign clouds.

### What the trigger gives us (confirmed from a real capture of your trigger)

`string(triggerOutputs())` of this trigger has the shape
`{ "headers": { ... }, "body": { "teamsFlowRunContext": { ... }, "cardOutputs": {} } }`,
so `triggerBody()` is the `body`. **Property names are PascalCase and
case-sensitive.** Everything useful is under
`triggerBody()?['teamsFlowRunContext']`:

| Path under `teamsFlowRunContext`        | What it holds                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MessagePayload.Id`                     | Message id: 13 digits, the message's **creation time in epoch milliseconds**                          |
| `MessagePayload.From.User.DisplayName`  | Sender's display name, in the form `Last, First`                                                      |
| `MessagePayload.From.User.Id`           | The sender's Entra (AAD) object id. **No email address anywhere.**                                    |
| `MessagePayload.Body.PlainText`         | The message as plain text (a mention shows as the person's name)                                      |
| `MessagePayload.Body.Content`           | The same as HTML (a mention is `<at id="0">Name</at>`); `Body.ContentType` is `html`. Not used.       |
| `MessagePayload.Subject`                | `null` for chat messages                                                                              |
| `MessagePayload.LinkToMessage`          | `https://teams.microsoft.com/l/message/<conversationId>/<messageId>?context=...`                      |
| `MessagePayload.ReplyToId`              | `null` unless the message is a reply                                                                  |
| `Conversation.Id`                       | The chat id, for example `19:<32 hex>@thread.v2` for a group chat                                     |
| `Conversation.Name`                     | The chat's name                                                                                       |
| `Conversation.IsGroup`                  | `true` or `false`                                                                                     |
| `ChannelData.Tenant.Id`                 | **The tenant GUID.** (Also in the header: `triggerOutputs()?['headers']?['x-ms-tenant-id']`.)         |
| `ChannelData.Team`, `ChannelData.Channel` | `null` for chats                                                                                    |
| `From.AadObjectId`                      | The user who ran the flow (you); not used                                                             |

There is **no separate created-time field**, but the message id is the creation
time, so `receivedAt` can be derived from it (below), with `utcNow()` as the
documented fallback.

The same information appears in the dynamic-content picker under friendlier names
(Message ID, Sender User Display Name, Plain Text Message Content, Link to
message, Reply to Message ID, Conversation ID, Conversation Name, Is Group, ...;
the picker has no tenant id and no created time). Both ways are given below.

### How the trigger fills the intake

| Intake field            | Typed expression (path under `triggerBody()?['teamsFlowRunContext']`)                  | Picker alternative                      | Notes                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                | constant `teams`                                                                       | (typed)                                 | Teams is default-deny until a chat or tenant is allowed (step 5).                                                                           |
| `sourceId`              | `Conversation.Id` + `/` + `MessagePayload.Id`                                          | **Message ID**                          | The de-duplication key: running the flow twice on one message gives one item. Do not mix the two ways: they build different keys.            |
| `receivedAt`            | derived from `MessagePayload.Id` (below)                                               | `utcNow()` (no created time in picker)  | The first derived date should be sanity-checked (step 4). Fallback `utcNow()` is when you clicked, which is fine; only an old message's age is lost. |
| `sender.name`           | `MessagePayload.From.User.DisplayName`                                                 | **Sender User Display Name**            | `Last, First`. No address: leave `sender.address` out.                                                                                      |
| `subject`               | `Conversation.Name`, else `Teams message`                                              | Conversation Name / Message Subject     | The chat's name is the title the app shows. An unnamed chat gets `Teams message`.                                                           |
| `body.text`, `format`   | `MessagePayload.Body.PlainText`; `format` is `text`                                    | **Plain Text Message Content**          | Plain text, so there is no HTML to clean. A mention keeps the person's name, so the text can start with it.                                 |
| `link`                  | `MessagePayload.LinkToMessage`                                                         | **Link to message**                     | "Open in Teams" in the app.                                                                                                                 |
| `thread.conversationId` | `Conversation.Id`                                                                      | **Conversation ID**                     | Messages with the same id are one conversation, which is how a reply is tied to the to-do it is about.                                      |
| `thread.parentId`       | `MessagePayload.ReplyToId`                                                             | **Reply to Message ID**                 | `null` unless a reply. The app treats `null` and empty text as "no parent".                                                                 |
| `context.chatId`        | `Conversation.Id`                                                                      | **Conversation ID**                     | What the app's **chat allowlist** compares. An explicit value here wins over the chat id inside the link.                                   |
| `context.chatType`      | `group` if `Conversation.IsGroup` is true, else `oneOnOne`                             | Is Group                                | Free text, informational (nothing in the app depends on it). Channel messages would need a third value; add one if you ever use channels.   |
| `context.tenantId`      | `ChannelData.Tenant.Id`                                                                | (not in the picker)                     | Lets the whole tenant through the filter. Optional if you allow chats instead.                                                              |

The flow **sends nothing**: no email, no Teams post, no approval. Its only
output is one file in your OneDrive. It uses only the Microsoft Teams trigger,
the built-in _Data operation_ **Compose**, and OneDrive for Business **Create
file**: all standard connectors, no Premium badge.

### 1. Create the flow

1. <https://make.powerautomate.com> -> make sure the environment (top right) is
   **your default environment** -> **Create** -> **Instant cloud flow**.
2. **Flow name**: `Send to PMO To-Do` (this name is what you will click in
   Teams, so keep it short and clear).
3. Trigger: **For a selected message (V2)** (Microsoft Teams) -> **Create**.
   Do not add the adaptive-card input; we do not need it.

### 2. Compose the intake (typed expressions)

1. **+** -> **Compose** (Data operation). Rename it (card title -> `...` ->
   Rename) to `Intake`.
2. Click in **Inputs** and paste exactly this. The `@{...}` parts are
   expressions Power Automate evaluates at run time (copy the whole block,
   including the long lines):

```json
{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "teams",
  "sourceId": "@{concat(triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id'], '/', triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Id'])}",
  "receivedAt": "@{formatDateTime(addSeconds('1970-01-01T00:00:00Z', div(int(triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Id']), 1000)), 'yyyy-MM-ddTHH:mm:ssZ')}",
  "sender": {
    "name": "@{triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['From']?['User']?['DisplayName']}"
  },
  "subject": "@{coalesce(triggerBody()?['teamsFlowRunContext']?['Conversation']?['Name'], 'Teams message')}",
  "body": {
    "text": "@{coalesce(triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Body']?['PlainText'], '')}",
    "format": "text"
  },
  "thread": {
    "conversationId": "@{triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id']}",
    "parentId": "@triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['ReplyToId']"
  },
  "context": {
    "tenantId": "@{triggerBody()?['teamsFlowRunContext']?['ChannelData']?['Tenant']?['Id']}",
    "chatId": "@{triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id']}",
    "chatType": "@{if(equals(triggerBody()?['teamsFlowRunContext']?['Conversation']?['IsGroup'], true), 'group', 'oneOnOne')}"
  },
  "attachments": [],
  "link": "@{triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['LinkToMessage']}"
}
```

3. If the designer turns the box into plain text or shows the expressions as
   literal text, use `...` -> _Peek code_ / _Edit in code view_ and paste the
   block into the action's `inputs` property instead.

Notes:

- **`receivedAt`:** the message id is the creation time in milliseconds since
  1970; the expression turns it into `2026-10-24T09:30:12Z`. Check the first
  derived date against the message (step 4). If it is wrong, or the run fails
  there (an id that is not a number), replace the whole value with
  `@{utcNow()}`: that is the moment you clicked, which is good enough.
- **`parentId`** has no braces on purpose: a bare `@...` keeps `null` as `null`.
  Empty text would also be accepted by the app; you do not need a condition.
- **`tenantId`:** if you would rather not send it, delete the line. The app then
  relies on the chat allowlist (step 5).
- **`subject`:** `coalesce` only skips `null`. If an unnamed chat arrives with an
  empty name instead of `null` you get an empty subject, which the app allows.
- No `sender.address` is sent: this trigger has no email address.

**Why the message text is safe here:** a chat message is full of quotes,
backslashes and line breaks. Because `Intake` is an **object** and each
expression is the entire value of its field, Power Automate puts each value into
the object _before_ it is turned into text and escapes it on the way, so a `"`
in the message cannot break the file. The next step writes `string(...)` of that
object. (If you ever build the JSON as text instead, see "Why Compose" at the
top: never splice a raw value into hand-typed JSON.)

#### Alternative: build it from the dynamic-content picker

If you prefer clicking to pasting expressions: paste this skeleton into
**Inputs** (it has only the intake's own property names), then put the cursor
between the two quotes of each value and pick the field from **Dynamic content**:

```json
{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "teams",
  "sourceId": "",
  "receivedAt": "",
  "sender": { "name": "" },
  "subject": "",
  "body": { "text": "", "format": "text" },
  "thread": { "conversationId": "", "parentId": "" },
  "context": { "chatId": "", "chatType": "" },
  "attachments": [],
  "link": ""
}
```

| Between the quotes of | Pick                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `sourceId`            | **Message ID**                                                                                |
| `receivedAt`          | **Expression** tab: `utcNow()` -> **Add** (the picker has no created time)                    |
| `name`                | **Sender User Display Name**                                                                  |
| `subject`             | **Conversation Name** (an unnamed chat then has an empty subject, which is allowed)          |
| `text`                | **Plain Text Message Content**                                                                |
| `conversationId`      | **Conversation ID**                                                                           |
| `parentId`            | **Reply to Message ID**                                                                       |
| `chatId`              | **Conversation ID**                                                                           |
| `chatType`            | **Expression** tab: `if(equals(<Is Group>, true), 'group', 'oneOnOne')`, with `<Is Group>` added from **Dynamic content** |
| `link`                | **Link to message**                                                                           |

Each pick must be the **whole** value of its field (nothing typed around it).
There is no tenant id in the picker; add `"tenantId": ""` to `context` and fill
it with the **Expression** tab:
`triggerBody()?['teamsFlowRunContext']?['ChannelData']?['Tenant']?['Id']`, or
leave it out and use the chat allowlist.

### 3. Write the file

Identical to Recipe A step 5 (**Create file**, OneDrive for Business), with the
file name `concat('teams-', guid(), '.json')` and file content
`string(outputs('Intake'))`. Use `/PMO-Inbox-test` while testing, then switch to
`/PMO-Inbox`. Save.

### 4. Test

1. In Teams, open a **test** chat (a chat with yourself works), write a message
   such as `Test: please send the RAID log to Pat by Friday`, hover it ->
   **...** -> **More actions** -> **Send to PMO To-Do** -> **Run**.
2. Power Automate -> **My flows** -> the flow -> **28-day run history**: green
   ticks. Open the run and look at `Intake`: `body.text` holds the message,
   `context.chatId` and `thread.conversationId` start with `19:`, `sender.name`
   is `Last, First`, and **`receivedAt` is today's date and about the time you
   clicked** (the message was just written; if it is a different day or year the
   derived time is wrong: use `utcNow()`).
3. The file appears in `PMO-Inbox-test` (OneDrive sync can take a minute).
   Remember that nobody gets a reply: the only evidence the flow ran is the run
   history and the file.
4. Point _Create file_ at `/PMO-Inbox`.

### 5. Allow the chat or tenant in the app

Until a chat or tenant is allowed, the app **filters every Teams item** (it is
default-deny, and says so in its status bar).

- **If you sent `tenantId`:** paste it under _Allowed Teams tenant IDs_ in
  Settings, or click **Allow this tenant** on the filtered item. Every Teams
  message from your tenant then comes through.
- **Or allow one chat at a time:** run the flow on a message; in the app open
  **Filtered**: the item shows its **Conversation ID** with an **Allow this
  chat** button. Click it. Each new chat needs its own click.

Then run the flow on the message again (a filtered message's text is discarded
by design, so it cannot be moved into the queue; it has to be sent again).

### 6. If a value comes out empty: capture the raw output

You do not need this for the set-up above; it is how the field list was found.
If a field is empty or an expression errors, capture once more. Add two
**temporary** actions at the end of the flow. They write the **whole** trigger
output to `/PMO-Debug`, **never** to `/PMO-Inbox`, so it cannot reach the queue:

1. **Compose**, rename `Raw`; **Expression** tab: `string(triggerOutputs())`.
2. **Create file** (OneDrive for Business): Folder `/PMO-Debug`; File Name
   (expression) `concat('teams-raw-', utcNow('yyyyMMddTHHmmss'), '.json')`; File
   Content: the **Outputs** of `Raw`.
3. Run the flow on a test message and open the file in a text editor, or open
   the `Raw` card's **Outputs** in the run history.

> **Warning: the capture contains a signed URL.** `headers` holds the trigger's
> own callback URL with a `sig=...` secret, and the run-history output of the
> trigger and of `Raw` shows it too. Treat the file as a secret: do not share it,
> do not paste it into a chat or ticket, and do not commit it. When you are done,
> **delete the capture file** from `PMO-Debug`, **delete the `Raw` and capture
> _Create file_ actions** from the flow, and, if you built a separate capture
> flow, **delete that flow**. If you want a fixture in the PMO To-Do repo, copy
> only the shape and replace every name, id and text with fictional values (see
> [`examples/teams-v2-selected-message.json`](./examples/teams-v2-selected-message.json)).

### Good to know

- **Sign-off replies from Teams** cannot be matched to the approver by email,
  because a Teams message has no address. The app can only match the sender's
  **display name** (it ignores order, so `Nair, Priya` matches an approver
  entered as `Priya Nair`). Enter the approver as a plain name if you expect the
  answer on Teams; an approver entered with an email address will never match a
  Teams reply (you can still tick "mark received" yourself).
- **No created time field**, so `receivedAt` is derived from the message id (or
  is the click time if you use the picker alternative).

---

## Checklist before you trust either flow

- [ ] Flow checker shows no errors and no card carries a Premium badge.
- [ ] Run history shows `body.text` with real line breaks as `\n` (not a failed
      run on a message that contained quotes).
- [ ] The only actions are: trigger, Compose/Select, Create file (and optional
      Rename file). No send, post, approve, HTTP or mail action.
- [ ] The Teams flow no longer contains the capture steps (`Raw` and its _Create
      file_), `PMO-Debug` has been emptied, and any separate capture flow is
      deleted (a capture contains a signed trigger URL).
- [ ] The file lands in `PMO-Inbox` and, within ~30 seconds of syncing, in the
      app's Review Queue (or under Filtered with a reason).
- [ ] Nothing client-related is flagged or selected while you are testing.
