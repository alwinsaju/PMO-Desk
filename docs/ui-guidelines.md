# UI guidelines

Decisions for the shared UI (see `docs/qa/uiux-2026-10-30/IMPLEMENTATION-PLAN.md`, Phase 1). Reuse the primitives in `src/components/ui/` and the tokens in `src/styles/tokens.css`; do not hand-roll per-app variants.

## Dialogs

`Dialog` (`src/components/ui/Dialog.tsx`) is the only modal surface. The panel is **fully opaque** (`bg-surface-elevated`: white in light/Deloitte light, the dark elevated neutral in dark themes), with a hairline `border-line-strong`, the `surface` radius (24 px, 14 px in Deloitte) and `shadow-modal`. Never put a translucent or glass class on a dialog: page text must not show through (QA-05). The backdrop is the soft `scrim` tint; its blur appears only in rich-effects mode.

- Title with `DialogTitle` (22 px), optional `DialogDescription`, actions in `DialogFooter` (see "Buttons and footers").
- Opening a modal closes every open `Tooltip` and `Popover` first (QA-15). This is central: `Dialog` announces via `ui/modalEvents.ts` and the two primitives subscribe, so callers need no code. Use the `ui` `Tooltip` / `Popover`, not the raw Radix ones, to get this.
- Do not nest a dialog inside popover content: the popover closes when the dialog opens and would take the dialog with it. Render the dialog as a sibling and open it from the popover's handler.

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
