# Templates

The **Templates** app is a library of email and report templates. It lets you change the wording
of a draft (subject, To, Cc and message) without opening a task folder, and lets you choose which
tasks and apps use each template. Nothing here sends anything: a template only sets the text of
a draft that you still review.

Open it from the dock (the page icon), the desktop right-click menu, or the command bar
(_Open Templates_).

## What you can do

- **Edit a template.** Pick one on the left. Change the name, the subject, To and Cc (email only)
  and the message. The preview on the right shows the result with example values. To and Cc show one
  chip per person, so a long list wraps instead of being cut off: type or paste addresses separated by
  a semicolon (`Name <a@x.com>; Name <b@x.com>`, or just `a@x.com, b@x.com`). A chip that is not an
  email address turns red and stops Save until you remove it. A `{{placeholder}}` also works as an address.
- **Insert a value.** The chips under the subject (`{{total}}`, `{{date_full}}` ...) put a
  placeholder at the cursor. Each task or app fills its own placeholders when it makes a draft.
  A placeholder it cannot fill stays as typed, so you can spot it in the draft.
- **Make words bold.** In an email, put two stars around words: `**prioritize review**`.
  Leave a blank line between paragraphs.
- **Choose where it is used.** Under _Used by_, tick the tasks and apps that should use this
  template. Each place uses **one** template: ticking a place another template has moves it to
  this one (the form says which). Delete a template, or untick a place, and that place goes back
  to its own built-in wording.
- **New template, Duplicate, Delete.** The **⋯** menu next to Save has _Duplicate_ (an unused copy to
  experiment with), _Restore original wording_ and _Delete template_. Delete does not ask first; a
  message at the bottom of the screen offers **Undo** for ten seconds, which puts the template back with
  its places, tags and wordings. **Tags, wordings, versions, test…** opens the extras.
- **Restore original wording.** The starter templates can be set back to what the task or app
  said before templates existed.

A new library starts with one template for each place below, wording identical to what each
produced before, so nothing changes until you edit one.

## Where a template can be used

| Place                           | Kind   | What it changes                                                    | Placeholders                                                    |
| ------------------------------- | ------ | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Aging Report                    | Email  | The draft's subject, To, Cc and greeting/message (the table stays) | `date_subject`, `date_full`, `total`, `people`                  |
| Backlog Report                  | Email  | The same                                                           | `date`, `total`, `people`                                       |
| Deployment & DEP Weekend Mailer | Email  | The same                                                           | `date`, `body_date`, `title`                                    |
| PMO To-Do: sign-off request     | Email  | The text offered when you request a sign-off                       | `greeting`, `title`, `by_date`, `summary`, `context`, `my_name` |
| PMO To-Do: chaser               | Email  | The "Use my template" button in the chaser dialog                  | `greeting`, `title`, `waiting_on`, `waited`, `my_name`          |
| PMO To-Do: weekly report        | Report | What Copy and the mail link produce, around the report             | `report`, `title`, `period`, `my_name`                          |

Notes:

- For the three mail tasks, a **blank To or Cc keeps the task's own recipients**, and a blank subject
  keeps its own subject. The report table and attachments are not part of a template.
- The change shows up the next time the task builds its draft (**Prepare**/**Run**); a draft that was
  already created keeps its text.
- For the weekly report, put `{{report}}` where the report should go (the starter is just
  `{{report}}`). The sign-off text and the chaser text are only ever shown in an editable box and
  copied or opened as an unsent mail; the app never sends them.
- The weekly report copy as Markdown keeps the report's own Markdown inside your wrapper.

## Where templates are stored

`%APPDATA%\ai-os\pmo\templates\library.json` in the installed app (`%LOCALAPPDATA%\AI OS\pmo\templates`
when run from source). The Tasks engine is started with `AI_OS_TEMPLATES_DIR` pointing at the same
folder, so the task scripts read the file the app writes. If the file cannot be read the app says so
and leaves it alone, and the tasks use their own wording.

## For developers

See "Version 5" in [`ARCHITECTURE.md`](../ARCHITECTURE.md): the model, the place catalog
(`src/lib/templates/targets.ts`), how the Python scripts apply a template
(`tasks/shared/template_lib/`) and how to add another place.
