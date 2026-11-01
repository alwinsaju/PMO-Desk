# UI guidelines

Decisions for the shared UI (see `docs/qa/uiux-2026-10-30/IMPLEMENTATION-PLAN.md`, Phase 1). Reuse the primitives in `src/components/ui/` and the tokens in `src/styles/tokens.css`; do not hand-roll per-app variants.

## Dialogs

`Dialog` (`src/components/ui/Dialog.tsx`) is the only modal surface. The panel is **fully opaque** (`bg-surface-elevated`: white in light/Deloitte light, the dark elevated neutral in dark themes), with a hairline `border-line-strong`, the `surface` radius (24 px, 14 px in Deloitte) and `shadow-modal`. Never put a translucent or glass class on a dialog: page text must not show through (QA-05). The backdrop is the soft `scrim` tint; its blur appears only in rich-effects mode.

- Title with `DialogTitle` (22 px), optional `DialogDescription`, actions in `DialogFooter` (see "Buttons and footers").
- Opening a modal closes every open `Tooltip` and `Popover` first (QA-15). This is central: `Dialog` announces via `ui/modalEvents.ts` and the two primitives subscribe, so callers need no code. Use the `ui` `Tooltip` / `Popover`, not the raw Radix ones, to get this.
- Do not nest a dialog inside popover content: the popover closes when the dialog opens and would take the dialog with it. Render the dialog as a sibling and open it from the popover's handler.

## Toasts

`toast()` (`lib/notifications/toastStore.ts`, drawn by `ui/ToastHost.tsx`) is for short, non-blocking confirmations. Every toast looks the same:

- **Position:** one stack, bottom-right inside the _active window_ (the host measures the focused window and follows it when dragged, resized or maximised), so a toast never hangs half outside it. With no window, or too little of it on screen, it sits at the bottom-right of the screen above the command bar.
- **Tone and icon:** `success` (check), `info` (i, the default), `warning` (triangle), `danger` (cross, the error tone; announced as an alert). Pick the tone that matches the outcome, not the colour you like.
- **Content:** a one-line `message` (<= 400 characters, tidied); an optional bold `title` (<= 80) above it ("Staff member added" / "Aarav Sharma was added to the Directory"). Say what happened and where to find it; do not just echo a button label.
- **Auto-dismiss:** 5 s; errors and toasts with an action stay 9 s; `durationMs: 0` keeps it until dismissed. Hovering or focusing a toast pauses its timer. Every toast also goes to the notification history (`title: message`).
- **Action:** at most one button (`action: { label: "Undo", run }`). Use it for Undo after a delete, snooze or cancel; running it dismisses the toast. A repeated `key` replaces the earlier toast instead of stacking (max 4 visible).
- Focus mode holds back everything but errors.

```ts
toast({
  tone: "success",
  title: "To-do closed",
  message: "Send weekly report",
  action: { label: "Undo", run: reopen },
});
```

## Buttons and footers

`Button` variants: `solid`/`primary` (the one main action), `secondary`, `outline`/`line`, `ghost`, `destructive` (solid red) and `destructive-quiet` (red text). Sizes `sm` 32 px, `md` 36 px (default), `lg` 44 px. Disabled buttons fade to 55 %, not lower, and keep their label readable; prefer explaining why (a `title` or hint) over leaving a mystery greyed-out button.

**Footer order, left to right:** `[destructive]` (pushed to the far left, apart from the rest) ... `[secondary / Cancel]` `[primary]`. The primary action is always the right-most button; Cancel/Close sits just left of it; a destructive action is never next to Save. `DialogFooter` does the separation automatically for any `destructive*` button; in other action bars give it `className="mr-auto"`. Use `destructive` (solid) when the destructive action is the whole point of the dialog (a delete confirm, where it is the primary), `destructive-quiet` when it sits beside Save/Hand over.

```tsx
<DialogFooter>
  <Button variant="destructive-quiet" onClick={remove}>
    Delete
  </Button>
  <Button variant="ghost" onClick={close}>
    Cancel
  </Button>
  <Button onClick={save}>Save</Button>
</DialogFooter>
```

**Icon-only buttons** use `IconButton`. `aria-label` is a required prop (the compiler rejects an `IconButton` without it) and doubles as the tooltip, shown on hover and keyboard focus. A more helpful hint can be passed as `tooltip="Hide this team"` (or `title`); `tooltip={false}` turns it off when the button is already inside another tooltip trigger. Do not wrap an `IconButton` in `Tooltip`. A disabled `IconButton` keeps the native `title` instead, so it can say why it is disabled. Never build an icon-only control from a bare `<button>`.

## Window title bar

54 px, left to right: the app icon in an accent chip (a generic window icon if the app gave none), the **app name** (semibold) and an optional **context suffix** (smaller, muted, after a middle dot), then pin, minimise, maximise/restore and close. The window's accessible name is "App name (suffix)".

- **Context suffix** = where the user is inside the window and/or live status: `Staff Management · Shift roster · 3 need attention`. An app sets the in-window part with `useWindowContext(windowId, "Shift roster")` (`window-manager/titleSuffixStore.ts`; cleared on unmount); an app-wide status comes from `setAppTitleSuffix(appId, ...)` (PMO uses it for "N need attention"). Keep it short; it truncates before the name does.
- **Controls** are 36 px round `IconButton`s (each with a tooltip from its label); pin/minimise/maximise appear on hover, focus or when the window is focused, close is always visible and turns red on hover.
- **No text selection while dragging.** The bar is `select-none`, and while a window is dragged or resized (`data-gesture` on it) text selection is off page-wide (`tokens.css`), so the drag never highlights text in the window underneath. Any selection made before the drag is cleared.

## Type scale, spacing, focus, contrast

**Type scale** (tokens `--type-*`, utilities in `globals.css`):

| Utility              | Size / line | Weight                    | Use                            |
| -------------------- | ----------- | ------------------------- | ------------------------------ |
| `type-page-title`    | 22 / 1.2    | headline (700, 300 in DL) | window and dialog titles       |
| `type-section-title` | 16 / 1.3    | 600                       | cards, panels, group headings  |
| `type-body`          | 14 / 1.5    | 400                       | running text, rows, inputs     |
| `type-caption`       | 12 / 1.4    | 500, muted ink            | hints, meta text, table labels |

Do not go below 12 px. Prefer these over `text-[13.5px]`-style one-offs in new code.

**Spacing** is an 8-px grid. Tailwind's own scale is 4 px per step (`p-2` = 8 px). CSS variables `--space-half` (4), `--space-1` (8) ... `--space-6` (48) exist for CSS, and `stack-N` (vertical flex) / `cluster-N` (wrapping row) set a gap of N x 8 px: `stack-2` = 16 px.

**Focus.** Every interactive primitive uses the `focus-ring` utility: a 2 px outline in `--color-focus` (accent; Dark Blue in Deloitte light because green fails 3:1 on white), offset 2 px (`--focus-ring-width`, `--focus-ring-offset`). Do not write `focus-visible:ring-*` or `outline-none` on new controls. Inputs keep their field border + glow.

**Contrast.** Normal text must reach WCAG AA (4.5:1) on the surface it sits on, in light, dark, Deloitte light and Deloitte dark. The palest text token, `--color-ink-faint` (placeholders, tertiary text), is pinned per theme to >= 4.5:1 on the base surface; `--color-ink-muted` is the usual caption colour. Disabled controls fade to `--opacity-disabled` (0.55), not lower, so they still read as controls. Settings > Accessibility > High contrast raises muted and faint text to full ink.

Screen-building rules and shared pieces: import UI from `@/components/ui` and helpers from `@/lib/ui/*`; see them live on the dev-only `/design` page.

## Empty, error and loading states

Never leave a pane blank, and never end on a dead-end message.

- **Empty** - `EmptyState`: icon, headline (what is empty), one sentence (what
  goes here or how to fill it) and, when there is an obvious next step, one
  primary action. Say "No runs yet", not "No runs match", unless a filter is
  actually applied (then offer "Clear filters").
- **Error** - `ErrorState`: what failed (`title`), the likely cause (`cause`),
  the next step (`nextStep`), a **Retry** button (`onRetry`) and **Copy
  details** (version, time, place and the technical line, built from the same
  text as `CopyDetailsButton`). Extra buttons (e.g. "Open in default browser")
  go in `actions`. Pass a cleaned technical line from
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
- **Long dialogs** keep their actions in view: a heading, a body that scrolls
  and a footer separated by a hairline (`DialogContent` with `p-0`, then the
  Staff `DialogHead` / `DialogScroll` / `StickyFooter` in
  `staff-app/FormParts.tsx`). Forms inside are two columns from `sm` up, grouped
  under section headings (`FormSection`); a field with rules uses
  `ValidatedInput` for the tick or warning icon next to the value.
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

## Dock, search and shell chrome (Phase 5)

- **Dock tiles** show the shared `Tooltip` with the app name, what the badge means ("3 need attention: 2 PMO
  items, 1 time-off request") and Open / Minimized. Pass the meaning with
  `useDockBadgeStore.setBadge(id, count, meaning)`. Open = accent dot and filled icon, minimised = hollow dot.
  Launchers (App Menu, "+") sit in their own group; apps that do not fit the screen move to the App Menu.
- **Keyboard hints** use `KeyHint` (`@/components/ui/KeyHint`), one cap per key: the command bar's empty state
  ("Ctrl" "Space") and Ctrl+K's footer. Do not type hints as plain text.
- **Answer card** (command bar): question as title, answer, footer with Copy then the primary "Show me in ..."
  button, dismiss in the corner. Status notices (not answers) keep the small bubble.
- **Ctrl+K** lists results in groups with headers, highlights the typed words with `<mark>` and shows "Recent"
  (last five opened) when empty.
- **Reordering** a list by dragging: a grip `button` with `useDrag` (window listeners), live preview, and the
  Up/Down arrow keys on the focused grip as the keyboard alternative (see Dashboard > Customise).
- **Settings screens** are cards: `Section` (title, optional description) holding `Row`s; give each row a
  `settingId` and add it to `lib/settings/settingsIndex.ts` so Settings search finds it (a test fails
  otherwise).

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
