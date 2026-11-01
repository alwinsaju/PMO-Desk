# PTO emails -> the shift roster (Power Automate flow)

People tell the team they are taking leave by email. You already have an Outlook rule
that moves those emails into a folder. This flow copies each one into OneDrive; AI OS
reads it with the **local AI model**, decides whether it is PTO, a **comp off** or sick
leave, works out the dates and files it as a **pending Time off request** for the sender.
You approve or reject it in **Staff Management > Time off**, like any other request; once
approved, the shift roster shows it on those days.

Nothing leaves your computer except the copy OneDrive already syncs for you. The flow
sends no email, posts nothing and asks nobody anything.

```
Outlook folder "PTO"  -->  flow  -->  OneDrive\AI-OS\PTO-Inbox  -->  AI OS (local AI)
                                                                       |-- clear or doubtful -> pending Time off (Approve / Reject)
                                                                       '-- no person or dates -> PTO-Inbox\rejected (with the reason)
```

## Before you start

1. Install AI OS (the installer creates `OneDrive - ...\AI-OS\PTO-Inbox` for you) and make
   sure OneDrive is signed in. The first-time setup page shows the same steps with
   pictures.
2. Your Outlook rule moves the PTO emails into one folder (the examples use `PTO`).
3. Leave the **Directory** filled in: the AI matches the sender's email address to a person
   there (Deloitte or Takeda address, or the same name).

## Build the flow

Go to <https://make.powerautomate.com> and sign in with your Deloitte account.

### 1. Create the flow and the trigger

1. **Create** -> **Automated cloud flow**.
2. **Flow name**: `AI OS - PTO email`.
3. Search `new email` and pick **When a new email arrives (V3)** (Office 365 Outlook) ->
   **Create**.
4. In the trigger card open **Advanced parameters** and tick **Folder**. **Click the folder
   icon and pick your PTO folder from the list.** (Typing the name does not work; the
   picker stores the folder's id.)
5. Leave **Include Attachments** and **Only with Attachments** on **No**. Leave the rest
   empty.
6. Click the trigger's **...** -> **Settings** -> turn **Concurrency Control** **Off** ->
   **Done**. (With it on, Power Automate skips runs when several emails arrive together.)

### 2. Compose the email

1. **+ New step** -> search `Compose` -> **Compose** (Data operation).
2. Rename it (card title -> **...** -> **Rename**) to `PtoEmail`.
3. Click **Inputs** and paste exactly this. Paste only the braces and what is inside them:
   no extra word in front (a stray `json` makes the flow write a file the app cannot read).

```
{
  "schema": "pto-mail/1",
  "sourceId": "@{triggerOutputs()?['body/id']}",
  "receivedAt": "@{triggerOutputs()?['body/receivedDateTime']}",
  "from": "@{triggerOutputs()?['body/from']}",
  "subject": "@{coalesce(triggerOutputs()?['body/subject'], '')}",
  "body": "@{coalesce(triggerOutputs()?['body/body'], '')}",
  "isHtml": "@{coalesce(triggerOutputs()?['body/isHtml'], false)}"
}
```

The email body is full of quotes and line breaks; because every value is a token inside an
object, Power Automate escapes it for you. If the designer turns the `@{...}` parts into
plain text, use the **...** menu -> **Peek code** / **Edit in code view** and paste the
object into the `inputs` property. If a field name is offered differently in your tenant,
delete that line's expression and insert the field from the dynamic-content picker
(**Message Id**, **Received Time**, **From**, **Subject**, **Body**, **Is HTML**).

### 3. Write the file

1. **+ New step** -> search `Create file` -> **Create file** (**OneDrive for Business**).
2. **Folder Path**: click the folder icon -> `AI-OS` -> `PTO-Inbox`.
3. **File Name**: **Expression** tab -> `concat('pto-', guid(), '.json')` -> **Add**.
4. **File Content**: **Expression** tab -> `string(outputs('PtoEmail'))` -> **Add**.
5. **Save**.

### 4. Test it

1. While you build, point **Folder Path** at a throwaway folder such as `/AI-OS/PTO-Inbox-test`
   and switch it to `PTO-Inbox` once the files look right. AI OS only reads `PTO-Inbox`.
2. Send yourself an email that says, for example, "I will be on leave from 2 to 4 November"
   and move it to the PTO folder.
3. Within a minute a file `pto-....json` appears in `PTO-Inbox`; AI OS opens it, reads it,
   deletes it and adds the leave to **Time off** as a **Pending** request (an envelope icon
   marks leave that came from an email). Press **Approve** or **Reject**; approved leave
   shows on the roster.
4. Try one that says "taking a comp off on 6 November" and check it is filed as **Comp off**.

## What the local AI decides

For each email it answers: PTO, comp off, sick leave, a cancellation, or not a leave email,
plus the first and last day away. The email is treated as data; instructions written inside
it are ignored.

| The AI reads                                                                     | What AI OS does                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| PTO, clear dates, a known sender                                                 | Files a **pending PTO** request.                                        |
| Comp off (the email says "comp off", "compensatory off", "time off in lieu" ...) | Files a **pending Comp off** request.                                   |
| Sick leave                                                                       | Files a **pending Sick leave** request.                                 |
| Not a leave email                                                                | Ignores it.                                                             |
| Anything that needs a closer look (below)                                        | Files it as pending too, with **Check this one: ...** in the Reason.    |
| No person or no usable dates, a cancellation, or a clash with other leave        | Moves the file to **`PTO-Inbox\rejected`** with a `.reason.txt` beside. |

The request carries **Check this one** in its Reason when:

- the AI is not sure, the dates are odd (over 45 days, far from today), or only part of a day
  is off;
- the AI says comp off but the email never says so, or says PTO but the email mentions a
  comp off (the two have to agree), or the email may be sick leave;
- the AI's quoted sentence is not really in the email.

The email is moved to `rejected` instead (nothing can be filed) when the sender is not in
the Directory (or two people share the name), the email gives no clear dates, it cancels
leave, or the person already has different time off on those days. Add the leave by hand in
**Time off > Add time off** if it is real.

The model sleeps on its own: it frees its memory two minutes after the last email, and the
chip beside the search box in **Time off** shows **PTO emails · Model asleep**, the countdown while it is
loaded, or what it is reading.

## It runs on its own

AI OS looks in `PTO-Inbox` a minute after it starts and then about once a minute, whether or not
a Staff window is open or even visible. The emails are read
with the **light model** (`qwen3.5:4b`, the same one as the **Fast AI model** switch in the
gear menu; if it is not downloaded yet, the model chosen in that menu is used). You do not
have to do anything: when the AI has filed a request, the AI orb at the bottom right shows a
note ("I read a leave email. It needs your approval.") with a **Review** button that opens
**Staff Management > Time off** on the pending requests. **Later** (or the cross) hides the note
for the requests it listed; a new request shows it again.

**AI_OS_PTO_SCAN_MS** changes how often it looks (default 60000, at least 5000; `0` or `off`
turns the background reading off, and the Staff window then reads the folder while it is open).

## If something does not work

- **Nothing appears in `PTO-Inbox`**: open the flow's **Run history**. _Skipped_ runs mean
  Concurrency Control is still on (step 1.6). No runs at all: the trigger folder was typed,
  not picked.
- **The file is there but nothing happens**: AI OS reads the folder on its own about every
  minute while it is running (and every 20 seconds while a Staff window is open); mail that
  arrives while it is closed is read soon after it starts. The local AI (Ollama and its model)
  has to be running; the setup check shows this. A model that has to load first adds about
  half a minute to the first email.
- **The file disappears into `PTO-Inbox\rejected`**: the app could not read it or could not
  turn it into a request; the `.reason.txt` next to it says why (for a file that cannot be
  read, usually extra text pasted before the `{`).
- **Wrong person**: check the sender's email in the Directory.
- **AI_OS_PTO_INBOX_DIR** points the app at a different folder; **AI_OS_PTO_AI_TIMEOUT_MS**
  changes how long it waits for the model per email (default 3 minutes).
