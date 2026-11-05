# Task packs

A task pack adds a task to PMO Desk without reinstalling it. Packs live in `%APPDATA%\ai-os\tasks-engine\task-packs`
(`tasks-engine/.data/task-packs` when running from the repo) and show up in the Tasks
app like the built-in tasks.

## Installing a pack

1. Tasks > **Packs** > **Install a pack…** and choose the `.zip`.
2. PMO Desk checks the pack, then shows its files, its steps and its **fingerprint** (a SHA-256).
3. Compare the fingerprint with the one the person who made the pack gave you, type it into the box, and
   press **Install**. The button stays off until the text matches.

A pack is refused, with the reason in plain words, when:

- a file does not match its checksum in `pack.json`, or the pack has files that are not listed (or lists
  files that are missing);
- an entry would land outside the pack's folder (`..`, absolute or drive paths, links);
- it contains a type of file packs may not carry (anything but `.json .py .ps1 .md .txt .html .htm .csv` and
  `.png .jpg .svg`);
- the task uses a step type the engine does not know, runs a file that is not in the pack, or asks for an
  input to be placed anywhere but `input/` or `config/`;
- the task has **no `review` or `confirm` step**, so it could run to the end (and send an email) without a
  person checking it. Every pack has to stop for you at least once;
- two files differ only by capital letters (Windows would treat them as one), or a file name contains a
  colon (a hidden data stream on Windows);
- its name is longer than 80 characters, or (after hidden characters such as a right-to-left override are
  removed, and ignoring capital letters) it is the same as the name of a built-in task or of a pack that is
  already installed. The message names the task that already has that name;
- its id belongs to a built-in task (this is checked before you are asked for the fingerprint), or its task is
  running right now (for an update);
- it is larger than 30 MB, has more than 200 files or unpacks to more than 25 MB.

**A pack's scripts run on this computer with your access.** The checksums prove the pack was not changed
after it was made, not that its author is trustworthy. Install packs only from people you trust. A task
stops at its review and confirm steps, but the scripts before and after them run without asking, and a
script is code.

The installed packs are listed with their id and a short fingerprint, so two packs with the same name can be
told apart.

### Testing without touching Outlook or Excel

Set `AI_OS_TASKS_OFFICE=off` before starting PMO Desk (or the Tasks engine) and every `powershell` step of
every task, including a pack's, is skipped: it writes one line to the task's log and counts as done. Nothing is
drafted, sent or recalculated, and the review and completion messages say so. `python` steps still run. Leave
it unset on a real user's computer.

An update keeps the pack's `input/`, `output/` and `config/` folders (your own files win over seeds in the new
pack). **Remove** deletes the pack including those folders, and asks first.

## Making a pack

A pack is a zip with:

- `pack.json`: `{"format": "ai-os-task-pack", "version": 1, "id": "my-task", "name": "My task",
"packVersion": "1.0", "files": {"task.json": "<sha256>", "scripts/run.py": "<sha256>", ...}}`. The id is
  lower-case letters, digits and hyphens, 3 to 50 characters. Every other file in the zip is listed with its
  SHA-256 (lower-case hex).
- `task.json`, the same manifest the built-in tasks use, with `"id"` equal to the pack's id.
- The scripts and any seed files (for example `config/settings.json`).

`tasks-engine/taskpacks.py` has `build_pack(id, name, version, files)` that writes the zip and computes the
checksums. Scripts find the shared libraries (such as `template_lib`) through the `AI_OS_TASKS_SHARED`
environment variable and the Templates library through `AI_OS_TEMPLATES_DIR`.

## The new-mailer wizard

Packs > **New mailer…** asks for a name, To and Cc, the wording (or the name of a template in the Templates
app, which is looked up each run so edits there apply) and whether the table you will upload is Excel or CSV.
It builds a pack from `tasks-engine/pack-templates/mailer/` and installs it. Each run:

1. you upload the table (`input/table.xlsx` or `input/table.csv`);
2. `build_email_data.py` fills the subject and message (`{{rows}}`, `{{date}}` and `{{columns}}` are
   available) and turns the table (optionally only some columns) into an HTML table;
3. `create_draft.ps1` saves an Outlook draft;
4. you review it, then confirm; only then does `send_draft.ps1` send it.

The wording and recipients are in the pack's `config/mail.json` and can be edited there.

To and Cc must be email addresses separated by semicolons (`a@x.com; Name <b@x.com>`); the wizard refuses
anything else. The email shows at most 500 table rows. A longer table gets a red line under it saying how many
rows are shown, and the review and confirm dialogs show the same warning (turn on "attach the table" to send
all rows).

### Other behaviour worth knowing

- Uploading a `.json` file (a task's settings) is refused if it is not valid JSON, and the file already on
  disk is kept. When a good one replaces another, the previous one is kept beside it as `<name>.json.bak`.
- A task can leave `"warnings": ["..."]` in `output/email-data.json`; the review and confirm dialogs show them
  next to the recipients (the Aging and Backlog tasks use this for people with no email in the roster).
- A finished run's output files are written to the run history, so the Open buttons and the History tab
  still work after the engine restarts.
- Rejecting a run at its review step, and a Force reset of a run that had started, are recorded in the
  history (outcome `rejected` / `cancelled`, the step the run was at, and who did it and when, as an approval
  stamp of kind `reject` / `reset`). The History tab shows them as "Rejected" and "Reset" and leaves them out
  of the success rate. A reset of a task that is idle or already failed adds nothing.
- The Run form checks the files you pick before Start (the shift roster workbook, the staff list, the team
  roster, the Deployment workbook, the incident exports, the previous monthly workbook). A file that does not
  look right is named, and Start stays off until you replace it or tick "start anyway".
