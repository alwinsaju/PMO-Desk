# Turn the PMO To-Do intake on: a short, concrete guide

Nothing here sends an email, a Teams message or a notification. Every step only
puts a message into a folder, and the PMO To-Do app turns it into a proposal
that waits for your **Approve**. Allow about 45 minutes the first time.

You will end up with: Outlook mail you **flag** (or a folder you choose) and
Teams messages you **pick** arriving in the app's Review Queue, plus a **Paste**
button for anything else.

Reference documents, if you want the detail: [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md)
(the flows), [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md) (the file format,
the filter, retention, the Outlook script).

---

## 1. Check the drop folder (2 minutes)

1. Open File Explorer, then `OneDrive - Deloitte (O365D)`.
2. Check that two folders exist in its root. Create them if not (right-click,
   New, Folder):
   - `PMO-Inbox` (the real one; keep it empty)
   - `PMO-Debug` (scratch space for capturing a Teams message; the app never
     reads it)
3. The full path of the first one must be exactly
   `C:\Users\alsaju\OneDrive - Deloitte (O365D)\PMO-Inbox`. If yours is different, open
   the app (step 2), click the gear and, on the **Me** tab, change the **Inbox folder**
   box (it checks the folder the same way the first-run setup does).
4. Right-click `PMO-Inbox` and choose **Always keep on this device**, so
   OneDrive keeps the folder fully on disk (a file that only exists "in the
   cloud" cannot be read by the app).

## 2. Open the app and look at the status bar (2 minutes)

1. Start PMO Desk the way you normally do, then click the **clipboard icon** in the
   dock (PMO To-Do).
2. The strip at the top shows: the model (**Model asleep** when nothing is using it,
   which is normal and saves about 12 GB of memory; **Loading model…**,
   **Working on a message** and **Model ready** while it is in use), **Scan now**,
   **Paste** and a **gear**. The model loads only when a message needs it, so the
   first message after a quiet spell takes 1-2 minutes longer; it unloads again 2
   minutes after the last one. Click the model status to see what it is doing
   (and to load or unload it by hand).
3. If you see a dark banner **Inbox folder not found**, step 1 is not right yet.
4. A grey banner **Teams items are being filtered** is expected until step 6.
5. Quick test of the whole pipeline without any flow: click **Paste**, type
   `Please send the vendor SOW to Pat by Friday` as the message text, click
   **Add to inbox**. Within about a minute it appears in **Review Queue** with
   the badge _Manual_ (see "What to expect", below). You can reject it.

## 3. Flow 1: flagged email, in Power Automate (10 minutes)

Skip this if you prefer the Outlook script (step 7); use one of the two for
Outlook, not both.

1. Go to <https://make.powerautomate.com>, signed in with your Deloitte account.
2. **Create**, **Automated cloud flow**, name it `PMO intake - flagged email`,
   trigger **When an email is flagged (V3)** (Office 365 Outlook), **Create**.
   Leave the trigger's fields empty: its **Folder** parameter is optional (hidden
   under **Advanced parameters**) and, unset, it watches the Inbox. Add it via
   **Advanced parameters** only if you want a specific folder.
3. Follow Recipe A in [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md), steps 2 to 5
   (Compose BodyText, two Selects, Compose Intake, OneDrive **Create file**).
   While building, point **Create file** at a folder `PMO-Inbox-test` (create it
   next to `PMO-Inbox`), not at `PMO-Inbox`.
4. **Save**, then in Outlook flag one of your own harmless mails. Check the run
   (My flows, the flow, 28-day run history): green ticks, and a file in
   `PMO-Inbox-test` within a minute or two.
5. Open that file in Notepad. Check `body.text` holds the mail, and `sender.address`
   is an email address. Then edit the flow's **Create file** folder to `PMO-Inbox`
   and Save.

## 4. Flow 2: Teams, "For a selected message (V2)" (15 minutes)

You have confirmed that this trigger fires, and a real capture of its output
gave the exact field paths, so this flow is built straight from Recipe B. The
trigger gives the message text (as plain text), the sender's **display name**
(no email address), the chat's name and **Conversation ID**, a link, and your
**tenant id**. It has **no created-time field**: the app derives the time from
the message id (and you check it once).

1. Power Automate, **Create**, **Instant cloud flow**, name `Send to PMO To-Do`,
   trigger **For a selected message (V2)** (Microsoft Teams), **Create**. Make
   sure the environment at the top right is your **default environment**.
2. Click **+** under the trigger, **Add an action**, search `Compose`, pick
   **Compose** (Data operation). Click its title, **...**, **Rename**, call it
   `Intake`.
3. Open [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md), Recipe B, step 2. Copy the
   whole JSON block, click in the **Inputs** box of `Intake` and paste it. (Prefer
   clicking? The same step has a dynamic-content-picker version: paste the empty
   skeleton, put the cursor between the quotes of each value and pick the field
   named in the table.) If the `@{...}` parts show as plain text, click **...**
   on the card, **Peek code**, and paste the block there instead.
4. **+**, **Add an action**, search `Create file`, pick **Create file**
   (**OneDrive for Business**). **Folder Path**: click the folder icon and pick
   `PMO-Inbox-test` (create that folder first, next to `PMO-Inbox`, so nothing
   reaches the app while you test). **File Name**: click in the box, the
   **Expression** tab, enter `concat('teams-', guid(), '.json')`, **Add**. **File
   Content**: **Expression** tab, `string(outputs('Intake'))`, **Add**.
5. **Save** (top right). Open **Flow checker**: no errors, and no card has a
   **Premium** badge.
6. In Teams, open a chat with yourself, write `Test: please send the RAID log to
Pat by Friday`, hover the message, **...**, **More actions**, **Send to PMO
   To-Do**, **Run**.
7. Power Automate, **My flows**, the flow, **28-day run history**, the newest run:
   green ticks. Click the `Intake` card and check its output: `body.text` holds
   your test message, `sender.name` is `Last, First`, `context.chatId` starts
   with `19:`, and **`receivedAt` is today's date and about the time you
   clicked**. If `receivedAt` is wrong or that card failed, replace its value in
   the box with `@{utcNow()}` (the moment you clicked) and run it again.
8. Open `PMO-Inbox-test` in File Explorer and open the file in Notepad to see the
   same thing. Then edit the flow's **Create file** folder to `PMO-Inbox` and
   **Save**. Delete the `PMO-Inbox-test` folder when you are done.

Nothing was captured to `PMO-Debug`, so there is nothing to clean up. If a value
ever comes out empty, Recipe B step 6 explains how to capture the raw output once
more. **That capture contains a signed trigger URL (`sig=...`)**: do not share it,
and delete the file, the capture actions and any capture flow afterwards.

Note for sign-off: a Teams message has no email address, so a reply from Teams is
matched to the approver **by display name only**. Enter the approver as a plain
name (`Priya Nair`) rather than an email address if you expect the answer on
Teams.

## 5. Teams "Share to Outlook" (optional alternative)

On a Teams message, **...**, **Share to Outlook** (if your Teams has it) puts the
message in an email you send to yourself. Flag it and it arrives like any other
flagged mail, with a real sender address, with no tenant list involved.

## 6. Allow your Teams tenant or chat in the app (2 minutes)

Until you do this, the app **filters every Teams item** (grey banner **Teams items
are being filtered**). Choose one way:

**A. Allow the whole tenant** (the flow sends your tenant id, so this is the
simplest):

1. Run the flow once on a message, as in step 4.
2. In the app open **Filtered**. The item says the tenant is not on the allowed
   list and shows the tenant id with an **Allow this tenant** button. Click it.
   (Or: click the **gear**, and under **Who is allowed in**, **Allowed Teams
   tenant IDs**, paste the tenant id, **Save settings**.)

**B. Allow one chat at a time** (nothing else from Teams gets in):

1. Run the flow on a message in that chat.
2. In **Filtered**, the item shows its **Conversation ID** (for example
   `19:...@thread.v2`) with an **Allow this chat** button. Click it. (Or paste
   the Conversation ID under **Allowed Teams chat IDs** in Settings, one per
   line.) Every other chat stays filtered until you allow it too.

Then run the flow on the message again: a Teams message that arrived before the
chat or tenant was allowed sits under **Filtered** and its text was discarded on
purpose, so it has to be sent again. The grey banner disappears once either list
has an entry.

While you are in Settings, check **Your names and aliases** (how the model
recognises a request addressed to you), **Blocked domains** and **Blocked terms**,
and **Keep logs and finished items for** (90 days by default).

## 7. The Outlook script (10 minutes; instead of, or besides, Flow 1 for a folder)

It reads classic Outlook directly and needs no flow. It is **read-only**: it
cannot send, delete, move or change a mail, and it does not open attachments.

1. Check you use **classic** Outlook: the toggle **New Outlook** at the top right
   of Outlook must be **off**. (New Outlook does not support this; the script
   will say so.) Keep Outlook open.
2. Open PowerShell (a normal one, **not** "Run as administrator") and go to the
   scripts folder:
   ```
   cd "C:\Projects\pmo-desk\pmo-intake\scripts"
   ```
3. Do a **dry run**. It reads Outlook, prints what it _would_ write, and writes
   nothing at all:
   ```
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Export-OutlookToInbox.ps1 -DryRun
   ```
   With no other option it considers every **flagged** mail in your mailbox.
   To use a folder instead (for example a folder `PMO` under Inbox):
   ```
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Export-OutlookToInbox.ps1 -FolderPath 'Inbox\PMO' -DryRun
   ```
4. Read the output. You should see lines like `WOULD WRITE
outlook-20261022T034400Z-57dfad4d.json ... "Subject ..."` and a last line
   `DRY RUN: would write N ... Nothing was written.` Check the senders shown are
   email addresses (not blank), and that `warning:` lines, if any, make sense.
   - Outlook may pop up _"A program is trying to access email address
     information"_. Tick **Allow access for 10 minutes** and click **Allow**.
     Clicking Deny three times makes the script stop with exit code 4.
   - "execution of scripts is disabled": run
     `Unblock-File .\Export-OutlookToInbox.ps1, .\OutlookMapping.ps1` once. If a
     company policy still blocks it, ask IT; do not change policies yourself.
5. When the dry run looks right, run it for real: the same command without
   `-DryRun`. It writes one file per mail into `PMO-Inbox` and records them in
   its own seen-file, so running it again writes nothing new. Use `-SinceDays 60`
   once to backfill further back.
6. Optional: run it every 15 minutes with Windows Task Scheduler. The installer
   ships the scripts, so on an installed PMO Desk (no repo needed) they are in
   `%LOCALAPPDATA%\Programs\PMO Desk\resources\app\pmo-intake\scripts\` (a different
   install folder, if you chose one, works the same way). Do steps 3 to 5 above
   once by hand first, then open **Command Prompt** (a normal one, **not** "Run as
   administrator"; `%LOCALAPPDATA%` is expanded by `cmd`, not by PowerShell) and
   paste this as one line:
   ```
   schtasks /Create /TN "PMO Outlook export" /SC MINUTE /MO 15 /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%LOCALAPPDATA%\Programs\PMO Desk\resources\app\pmo-intake\scripts\Export-OutlookToInbox.ps1\" -SinceDays 3" /F
   ```
   With no `/RU` the task runs as you and only while you are signed in, which
   Outlook needs. Test it with `schtasks /Run /TN "PMO Outlook export"`, then read
   the last line of `%LOCALAPPDATA%\AI OS\pmo-intake\outlook-export.log`. Remove it
   with `schtasks /Delete /TN "PMO Outlook export" /F`. A hidden run cannot answer
   Outlook's "a program is trying to access email address information" prompt
   (it stops after three denials and logs why), so answer **Allow** once during
   the manual run, or see the notes in
   [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md) (it also has a
   `Register-ScheduledTask` version for a repo checkout). The task is not
   removed when you uninstall PMO Desk: delete it as above.
7. Alternative with no Outlook automation at all: the Power Automate flag-email
   flow in section 3 ([`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md), Recipe A). Use
   one of the two for Outlook, not both. Nothing in the app runs the script for
   you, and there is no "Run now" button.

If a mail you expected was filtered because its sender's domain is not allowed,
allow the domain (Filtered tab, **Allow \<domain\>**), then run the script again
with `-IgnoreSeen` to send it again.

## 8. What to expect in the app

- **Timing.** A file in `PMO-Inbox` reaches the laptop in a couple of seconds;
  the app scans every 15 seconds (or press **Scan now**); the local model then
  needs roughly 50 to 100 seconds per message, and the first one after it has
  been idle a minute or two more (the status bar says so). Items appear first as
  _pending_ / _structuring_, then _ready_.
- **Review Queue.** Each _ready_ item shows a draft to-do. Open it to compare
  with the original, edit it, then **Approve** (creates the to-do) or **Reject**.
  Nothing becomes a to-do without you. A model that thinks a message is not a
  task puts it under **Probably not a task**.
  The app tidies the model's usual slips before you see the draft (a deadline
  that had already passed when you read an old message is dropped, "high" priority
  needs real urgency, the same step is not listed twice, "waiting on" is only for
  somebody else's delivery to you); a quiet "Adjusted by the app: ..." line says
  what it changed. **Repeats (optional)** holds a cadence such as "weekly, before
  Tuesday" when the message asks for something every week; it is shown on the
  to-do for reference, and the app does not repeat it or remind you again by itself.
- **Filtered.** Anything outside the rules lands here with the reason (not a
  Deloitte sender, a blocked domain or term, a Teams tenant that is not allowed).
  Filter the list by reason with the pills at the top. A filtered message's
  **text is not kept**, so it cannot be moved into the queue; allow the sender,
  tenant, chat or domain with one click and send it again.
- **Paste.** Pasted text is trusted as yours (the Teams tenant rule does not
  apply) but still obeys your blocked domains and terms, including an address
  inside the pasted text. Pasting the same text twice counts once.
- **Cleanup.** Daily, old logs and the saved text of finished items are removed
  (Settings, retention). Open to-dos keep their message.

## 9. If something does not show up

| You see                                                   | Check                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Banner "Inbox folder not found"                           | Step 1: the folder path in the status bar must exist.                                                                                      |
| File in OneDrive but nothing in the app                   | The file must end in `.json` and be fully on this PC (Always keep on this device); press **Scan now**; look in **Filtered**.               |
| Everything from Teams is under Filtered                   | Step 6: allow the tenant, or the chat (**Allow this chat** shows the Conversation ID).                                                     |
| Outlook mail under Filtered, "no readable sender address" | The Outlook script could not turn an Exchange address into an email address: re-run it with Outlook open and answer the prompt with Allow. |
| `rejected-files` banner                                   | A producer wrote something that is not valid; the reason is in `rejected-files\...reason.txt` in the data folder.                          |
| Script says "New Outlook is running"                      | Turn the **New Outlook** toggle off and restart Outlook.                                                                                   |
| Nothing structured, "Local model not running"             | The app starts its own local model; wait a minute and press **Scan now**; items stay pending and are retried.                              |

## 10. Turn on reminders (5 minutes)

Reminders tell you when a to-do is **due tomorrow**, **overdue** (every working
day from 09:00 on the due day), or when you are **waiting on someone** and
nothing has changed for 2 working days. They are shown on this computer only;
nothing is sent to anyone.

1. **Desktop app (the reliable way).** Nothing to switch on: while PMO Desk is
   running it checks every minute and shows a Windows notification, even with
   the PMO window closed. Click it to open the PMO app on that to-do. The dock
   icon for PMO To-Do shows a number badge, and the taskbar icon shows the same
   count.
2. **Keep it running when you close the window.** PMO window, gear (Settings),
   **Reminders**, tick _Keep running in the tray so reminders still fire_, then
   **Save settings**. Closing the window now hides PMO Desk to the system tray
   (bottom right, maybe under the ^ arrow). Right-click the tray icon for **Open
   PMO Desk** or **Quit**; Quit closes everything. Untick it and closing the window
   quits again, as before.
3. **In a browser tab (only while the tab is open).** Open PMO To-Do, click
   **Enable reminders** in the grey strip under the status bar and allow
   notifications. If you refuse, you still get the badge on the dock icon and a
   count in the tab title, such as `(3) PMO Desk`. Browser reminders stop when the
   tab closes, so use the desktop app for anything you must not miss.
4. **What the notification says.** By default only "PMO To-Do: 3 items need
   attention", never a task name, so nothing shows on a shared screen or in the
   notification centre. To see the title, untick _Hide task details in
   notifications_ in Settings, Reminders.
5. **Tune it.** Settings, Reminders: working hours and days (default 09:00 to
   18:00, Mon to Fri; reminders wait for the start of the day), time zone
   (Asia/Kolkata), how many working days before a chaser (2), an optional morning
   digest, and a master switch. To silence one to-do for a while use **Snooze** on
   its row or in its window (1 hour, tomorrow 09:00, next Monday, or a date and
   time).

If no notification appears in the desktop app, check Windows **Focus assist / Do
not disturb** and Settings, System, Notifications, **PMO Desk**. The log
`desktop.log` (Developer menu, Open logs folder) says whether a notification was
shown or failed.

## 11. Waiting, chasers and replies in the same conversation (phase 4)

Nothing here sends anything. The app only drafts text and shows you changes to
approve.

- **Waiting on someone.** Open a to-do, and in the Waiting box type who you are
  waiting on and press _Mark waiting_ (or pick the requester or sender). The list
  then shows "Waiting on Priya Nair since Mon 19 Oct (7 days)". When they answer,
  press _Got a reply (clear waiting)_ (also on the list row). You can backdate the
  start and change how soon you are reminded ("Chase after N working days") for
  that to-do; the default is in Settings.
- **Draft a chaser.** On a waiting to-do press _Draft a chaser_. The local model
  writes a short polite follow-up (it can take a minute on this PC; you can close
  the window and come back). Edit it, then _Copy_, or _Open as unsent mail draft_,
  which opens a new message in your mail program with the text filled in. You press
  Send yourself; the app never does.
- **Replies in the same conversation.** When a new email (or Teams message in the
  same chat) belongs to a to-do that is still open, it does not become a second
  proposal. It appears in the Review Queue as **Update to existing to-do**: tick
  the changes you want (clear "waiting", a new due date, a new action item, a note),
  then _Approve_. _Reject_ throws it away; _Create as separate to-do instead_ treats
  it as a new task. If it looks like a reply from the person you were waiting on,
  the card suggests clearing "waiting". Approved messages are listed in the to-do's
  **Timeline** tab, where you can open them.
- Matching needs the producer to fill `thread.conversationId` (the Outlook script
  and the Outlook flow do; a Teams message is matched by its chat). A paste never
  matches an existing to-do.

## 12. Weekly status report (phase 5)

The **Reports** tab writes your weekly status from the to-dos in this app. It
covers PMO To-Do items only: nothing is read from Excel, ServiceNow, SharePoint
or any tracker, and nothing is sent anywhere. It is text for you to review, edit,
copy and save.

1. Open **Reports**, pick a period (_This week so far_, _Last week_, _Last 7 days_
   or a custom range; weeks run Monday to Sunday, in India time) and press
   **Generate**. The report appears at once. It lists what was completed and what
   is new in the period and, as of now, what is in progress, overdue, waiting on
   others, due in the next 7 days and needs a decision. Long lists show the first
   10 and "+N more".
2. Optional: **Write highlights with AI**. The local model drafts a short
   Highlights, Risks / blockers and Next week focus from the titles, owners and
   dates in the report (it can take a minute on this PC; the report is complete
   without it). Lines that name a title, person or date that is not in your data
   are left out and the card says how many. Press **Add to the report** to put the
   lines into the text. Read them: the check cannot tell whether a sentence says
   something sensible.
3. Edit the text. **Copy as text** gives plain text for Outlook or Teams;
   **Copy as Markdown** gives the Markdown. **Open as unsent mail draft** appears
   only when the text is short enough for a mail link (most reports are not: use
   Copy). **Save** keeps it on this computer as a new revision.
4. Saved reports are in the data folder under `reports\` as `<date>-<id>.md`
   (revision 1), `<date>-<id>.r2.md`, ... and a `.json` file with the period and
   the full data; a report with a long list also has a `.full.md` with every item.
   They are never deleted automatically. The title (and an optional project name)
   are in Settings, _Weekly report_.

## 13. Approval and sign-off (phase 6)

For work that needs somebody's approval, create the to-do with the **Approval**
checkpoints (Draft, Sent for sign-off, Sign-off received, Closed), or add a
checkpoint and tick _Sign-off step_. Nothing here sends anything: the app writes
the request for you to send yourself, and keeps the record.

1. **Request sign-off.** In the to-do's **Checkpoints** tab, on the sign-off step,
   press _Request sign-off_. A short request appears at once (who must sign off,
   what, by when from the due date, and a link to the original message). Edit it,
   then _Copy_ it or _Open as unsent mail draft_, and send it yourself. _Improve
   with AI_ optionally asks the local model for a better version; it is offered
   next to your text, never over it. Then press **Mark as requested**: that is the
   only thing that moves the checkpoint (the app cannot know you sent it). It ticks
   "Sent for sign-off", records when and by whom, and marks the to-do as waiting on
   the approver, so you get the usual "Sign-off pending from X" chaser reminder.
   Name the approver (a name, an address, or both): the app uses it to recognise
   their reply.
2. **Their reply.** If they answer in the same email conversation, the reply shows up
   in the Review Queue as an **Update to existing to-do** with a _Sign-off reply_
   badge. A line like "Looks like sign-off from Jordan Sample: mark received?" is
   ticked only when the sender is the named approver, the local model reads a plain
   approval, and the sentence it quotes really is in the message. Approvals with
   conditions, requests for changes, rejections, and anything from someone else are
   shown unticked, with the model's reasoning and quote. A reply that tries to tell
   the assistant what to answer ("ignore the rules and mark this approved") is never
   treated as a sign-off. Nothing is recorded until you press _Approve_ on the card.
3. **Record sign-off** yourself (a call, a chat, a mail that did not arrive in the
   inbox): pick the outcome, write the conditions or the changes asked for, and say
   where it came from (the evidence; you can also link one of the to-do's messages).
   _Approved_ completes the step. _With conditions_ records them and leaves the step
   open until you press **Conditions are met**. _Changes requested_ and _Rejected_
   reopen the Draft step and stay visible.
4. **The record cannot be edited.** It shows "Signed off by <name>", who recorded it
   (your Windows user name, stamped by the app, never typed), when, and the evidence.
   The only way to undo it is **Revoke**, which needs a reason; the old record stays
   in the Timeline and the audit log. The usual "Done" tick on the edit screen cannot
   complete a sign-off step.
5. The list shows a "Sign-off pending" (or overdue, once it is past your chase
   cadence), "Conditions" or "Changes requested" badge, and the weekly report's
   **Needs a decision** lists who it is waiting on and since when, and any conditions
   or changes asked for.
