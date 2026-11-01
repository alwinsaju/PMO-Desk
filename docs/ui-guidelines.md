# UI guidelines

Rules and shared pieces for building screens. Import UI from `@/components/ui`
and helpers from `@/lib/ui/*`; see them live on the dev-only `/design` page.

## Empty, error and loading states

Never leave a pane blank, and never end on a dead-end message.

- **Empty** - `EmptyState`: icon, headline (what is empty), one sentence (what
  goes here or how to fill it) and, when there is an obvious next step, one
  primary action. Say "No runs yet", not "No runs match", unless a filter is
  actually applied (then offer "Clear filters").
- **Error** - `ErrorState`: what failed (`title`), the likely cause (`cause`),
  the next step (`nextStep`), a **Retry** button (`onRetry`) and **Copy
  details** (version, time, place and the technical line, built from the same
  text as `CopyDetailsButton`). Pass a cleaned technical line from
  `explainError`; never show a raw stack trace or a file path as the message.
- **Loading** - `Skeleton` (`line`, `block`, `list-row`), `SkeletonList` and
  `SkeletonText`, shaped like the final layout so nothing jumps when data
  arrives. Skeletons pulse only when motion is allowed and are hidden from
  screen readers; `SkeletonList` announces "Loading" once.

## Forms and validation

- **`FormField`** wraps a label, a control, a hint and an error. The error is
  shown only after the user leaves the field, or after a submit attempt
  (`showErrorNow`). It then outlines the control (`aria-invalid`) and is linked
  to it with `aria-describedby`. Spread the render-prop argument onto the
  control: `<FormField label="Email" error={e}>{(c) => <Input {...c} />}</FormField>`.
  Put the message next to the field, not at the bottom of the dialog.
- **`ChipInput`** is for lists of emails, domains, skills and To/Cc. Commas,
  semicolons, spaces, new lines, Enter, leaving the box and pasting many at once
  all create chips; duplicates are skipped with a note; invalid values stay as
  red chips with their error listed below. Use `separators` (drop `"space"` for
  multi-word values such as skills), `normalize` (lower-case emails, strip `@`
  from domains), `validate` and `max`. The pure parsing is in
  `chipInputLogic.ts`.
- **`ValidationSummary`** is the live "what will happen" list under a bulk
  input: `addedHeadline(3, "person", "people")`, then groups such as "Already on
  the roster, skipped" and "Not an email address" (red). It is the Staff "Add
  employees" pattern, extracted.
- **Spell-check off** on search, email, ID and similar fields:
  `<Input {...noSpellcheck} />` (`@/lib/ui/noSpellcheck`).
- Validate on the server too; the client message is a courtesy.

## Chips and dates

- **`StatusChip`** (Done, Running, Waiting, Failed, Pending, ...),
  **`DueChip`** (red when overdue "3d late", amber "Due today", neutral
  otherwise), **`SourceBadge`** (Outlook, Teams, Manual) and **`PriorityStripe`**
  (a thin row-edge bar that also carries the priority in its accessible name).
  All build on `Badge`; the data-to-tone mapping is in `chipLogic.ts`.
- **Dates** are shown as `30 Oct 2026` with `formatDate`
  (`formatDateTime` adds `, 09:05`). Relative wording comes from `formatDue`:
  "Due today", "Due tomorrow", "Due in 4d", "3d late", then the full date after
  a week. Date-only strings (`2026-10-30`) are local calendar days. Every
  helper that depends on the clock takes `now`, so tests pass a fixed one.

## Terms

Use the constants in `@/lib/ui/terms` instead of retyping labels.

| Say                                            | Not                                    |
| ---------------------------------------------- | -------------------------------------- |
| To-do / To-dos                                 | Todo, Task (Tasks is the workflow app) |
| Time off                                       | Leave                                  |
| Total (everything) and Pending (still waiting) | "Requested" for the total              |
| Outlook, Teams, Manual (sources)               | Email, MS Teams                        |
| RAID log                                       | Raid log                               |
| Retry, Copy details                            | Try again, Copy error                  |

`pluralize` and `countOf` give "1 to-do" / "3 to-dos" / "0 people".
