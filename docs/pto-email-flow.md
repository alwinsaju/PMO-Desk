# PTO emails -> the shift roster (Power Automate flow)

People tell the team they are taking leave by email. You already have an Outlook rule
that moves those emails into a folder. This flow copies each one into OneDrive; AI OS
reads it with the **local AI model**, decides whether it is PTO, a **comp off** or sick
leave, works out the dates and files it as **approved Time off** for the sender. The
shift roster then shows it on those days.

Nothing leaves your computer except the copy OneDrive already syncs for you. The flow
sends no email, posts nothing and asks nobody anything.

```
Outlook folder "PTO"  -->  flow  -->  OneDrive\AI-OS\PTO-Inbox  -->  AI OS (local AI)
                                                                       |-- clear     -> approved Time off -> shift roster
                                                                       '-- not sure  -> "needs a look" in Time off
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
   deletes it and shows the leave in **Time off** (an envelope icon marks leave that came
   from an email) and on the roster.
4. Try one that says "taking a comp off on 6 November" and check it is filed as **Comp off**.

## What the local AI decides

For each email it answers: PTO, comp off, sick leave, a cancellation, or not a leave email,
plus the first and last day away. The email is treated as data; instructions written inside
it are ignored.

| The AI reads                                                                     | What AI OS does                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| PTO, clear dates, a known sender                                                 | Files **approved PTO**.                                  |
| Comp off (the email says "comp off", "compensatory off", "time off in lieu" ...) | Files **approved Comp off**.                             |
| Sick leave                                                                       | Files **approved Sick leave**.                           |
| Not a leave email                                                                | Ignores it (still listed under "Recently handled").      |
| Anything else below                                                              | Keeps it under **Time off > PTO emails > needs a look**. |

An email waits for you (nothing is filed) when:

- the sender is not in the Directory, or two people share the name;
- the AI is not sure, the dates are missing or odd (over 45 days, far from today, end before
  start), or only part of a day is off;
- the AI says comp off but the email never says so, or says PTO but the email mentions a
  comp off (the two have to agree);
- the AI's quoted sentence is not really in the email;
- the email cancels leave, or the person already has different time off on those days.

There you pick the person, kind and dates (already filled with what the AI read) and press
**File as approved leave**, or **dismiss** it.

## If something does not work

- **Nothing appears in `PTO-Inbox`**: open the flow's **Run history**. _Skipped_ runs mean
  Concurrency Control is still on (step 1.6). No runs at all: the trigger folder was typed,
  not picked.
- **The file is there but nothing happens**: AI OS reads the folder when it is open (about
  every 20 seconds) and when you press **Read now**; mail that arrives while it is closed
  is read at the next start. The local AI (Ollama and its model) has to be running; the
  setup check shows this.
- **The file disappears into `PTO-Inbox\rejected`**: the app could not read it; the
  `.reason.txt` next to it says why (usually extra text pasted before the `{`).
- **Wrong person**: check the sender's email in the Directory.
- **AI_OS_PTO_INBOX_DIR** points the app at a different folder; **AI_OS_PTO_AI_TIMEOUT_MS**
  changes how long it waits for the model per email (default 3 minutes).
