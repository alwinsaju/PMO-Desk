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

1. Open File Explorer, then `OneDrive - Deloitte`.
2. Check that two folders exist in its root. Create them if not (right-click,
   New, Folder):
   - `PMO-Inbox` (the real one; keep it empty)
   - `PMO-Debug` (scratch space for capturing a Teams message; the app never
     reads it)
3. The full path of the first one must be exactly
   `C:\Users\alsaju\OneDrive - Deloitte\PMO-Inbox`. If yours is different, open
   the app (step 2), click the gear, and read the **Inbox folder** line, then
   change `inboxDir` in `config.json` (the Data folder line shows where).
4. Right-click `PMO-Inbox` and choose **Always keep on this device**, so
   OneDrive keeps the folder fully on disk (a file that only exists "in the
   cloud" cannot be read by the app).

## 2. Open the app and look at the status bar (2 minutes)

1. Start AI OS the way you normally do, then click the **clipboard icon** in the
   dock (PMO To-Do).
2. The strip at the top shows: the model (**Local model ready**, or **idle** until
   the first message), `N filtered`, the **inbox path**, **Scan now**, **Paste**
   and a **gear**.
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

## 4. Flow 2: Teams, "For a selected message" (15 minutes)

You have already confirmed that this trigger fires and gives a **tenant id**, a
**LinkToMessage** link and a **messagePayload** (with the message id). What is not
yet confirmed is the names of the message text and sender name inside
`messagePayload`, so the first version of this flow only **captures** one real
output.

1. Power Automate, **Create**, **Instant cloud flow**, name `Send to PMO To-Do`,
   trigger **For a selected message** (Microsoft Teams). Make sure the
   environment at the top right is your **default environment**.
2. Add **Compose**, rename it `Raw`, click in its box, open the **Expression**
   tab and paste `string(triggerOutputs())`, then **Add**.
3. Add **Create file** (OneDrive for Business): Folder `/PMO-Debug`, File Name
   expression `concat('teams-raw-', utcNow('yyyyMMddTHHmmss'), '.json')`, File
   Content = the `Raw` step's output. **Save**.
4. In Teams, open a chat with yourself, write `Test: please send the RAID log to
Pat by Friday`, hover it, **...**, **More actions**, **Send to PMO To-Do**,
   **Run**.
5. Open `PMO-Debug` and open the new `teams-raw-....json` in Notepad (Format,
   Word wrap). Find, inside `messagePayload`: the text of your message (probably
   under `body` then `content`), the sender's name (probably `from`, `user`,
   `displayName`) and the created time (probably `createdDateTime`). Also note
   the top-level `tenantId` (a GUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
   **Copy that GUID somewhere; you need it in step 6.**
6. Replace the `Raw` and capture steps by the `Intake` Compose and Create file
   from Recipe B in [`PA-FLOW-RECIPES.md`](./PA-FLOW-RECIPES.md), using the real
   names you found, writing first to `PMO-Inbox-test`. Run it on the same Teams
   message and check the file: the text is in `body.text`, the tenant GUID is in
   `context.tenantId`. Then point it at `PMO-Inbox`.
7. **Delete the capture file** from `PMO-Debug`: it can hold your real message
   text and request headers. Do not share it.

## 5. Teams "Share to Outlook" (optional alternative)

On a Teams message, **...**, **Share to Outlook** (if your Teams has it) puts the
message in an email you send to yourself. Flag it and it arrives like any other
flagged mail, with a real sender address, with no tenant list involved.

## 6. Add your Teams tenant ID in Settings (2 minutes)

1. In the app click the **gear**.
2. Under **Who is allowed in**, in **Allowed Teams tenant IDs**, paste the GUID
   from step 4. One per line; it is checked for the right shape as you save.
3. **Save settings**. The grey Teams banner disappears.
4. Run the Teams flow on a message again. (A Teams message that arrived before
   the tenant was allowed sits under **Filtered**; its text was discarded on
   purpose, so it has to be sent again.)

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
   cd "C:\Projects\AI OS\pmo-intake\scripts"
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
6. Optional: run it every 15 minutes. The Task Scheduler snippet (not applied
   for you) is in the Outlook script section of
   [`PMO-INTAKE-CONTRACT.md`](./PMO-INTAKE-CONTRACT.md).

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
- **Filtered.** Anything outside the rules lands here with the reason (not a
  Deloitte sender, a blocked domain or term, a Teams tenant that is not allowed).
  Filter the list by reason with the pills at the top. A filtered message's
  **text is not kept**, so it cannot be moved into the queue; allow the sender,
  tenant or domain with one click and send it again.
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
| Everything from Teams is under Filtered                   | Step 6: the tenant ID.                                                                                                                     |
| Outlook mail under Filtered, "no readable sender address" | The Outlook script could not turn an Exchange address into an email address: re-run it with Outlook open and answer the prompt with Allow. |
| `rejected-files` banner                                   | A producer wrote something that is not valid; the reason is in `rejected-files\...reason.txt` in the data folder.                          |
| Script says "New Outlook is running"                      | Turn the **New Outlook** toggle off and restart Outlook.                                                                                   |
| Nothing structured, "Local model not running"             | The app starts its own local model; wait a minute and press **Scan now**; items stay pending and are retried.                              |

## 10. Turn on reminders (5 minutes)

Reminders tell you when a to-do is **due tomorrow**, **overdue** (every working
day from 09:00 on the due day), or when you are **waiting on someone** and
nothing has changed for 2 working days. They are shown on this computer only;
nothing is sent to anyone.

1. **Desktop app (the reliable way).** Nothing to switch on: while AI OS is
   running it checks every minute and shows a Windows notification, even with
   the PMO window closed. Click it to open the PMO app on that to-do. The dock
   icon for PMO To-Do shows a number badge, and the taskbar icon shows the same
   count.
2. **Keep it running when you close the window.** PMO window, gear (Settings),
   **Reminders**, tick *Keep running in the tray so reminders still fire*, then
   **Save settings**. Closing the window now hides AI OS to the system tray
   (bottom right, maybe under the ^ arrow). Right-click the tray icon for **Open
   AI OS** or **Quit**; Quit closes everything. Untick it and closing the window
   quits again, as before.
3. **In a browser tab (only while the tab is open).** Open PMO To-Do, click
   **Enable reminders** in the grey strip under the status bar and allow
   notifications. If you refuse, you still get the badge on the dock icon and a
   count in the tab title, such as `(3) AI OS`. Browser reminders stop when the
   tab closes, so use the desktop app for anything you must not miss.
4. **What the notification says.** By default only "PMO To-Do: 3 items need
   attention", never a task name, so nothing shows on a shared screen or in the
   notification centre. To see the title, untick *Hide task details in
   notifications* in Settings, Reminders.
5. **Tune it.** Settings, Reminders: working hours and days (default 09:00 to
   18:00, Mon to Fri; reminders wait for the start of the day), time zone
   (Asia/Kolkata), how many working days before a chaser (2), an optional morning
   digest, and a master switch. To silence one to-do for a while use **Snooze** on
   its row or in its window (1 hour, tomorrow 09:00, next Monday, or a date and
   time).

If no notification appears in the desktop app, check Windows **Focus assist / Do
not disturb** and Settings, System, Notifications, **AI OS**. The log
`desktop.log` (Developer menu, Open logs folder) says whether a notification was
shown or failed.
