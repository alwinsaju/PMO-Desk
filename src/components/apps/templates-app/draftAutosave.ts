// Autosave for the template editor: what is typed is kept (in this computer's browser
// storage, never sent anywhere) so an accidental close does not lose it. A kept draft
// is offered back only if the saved template has not changed since, and is dropped on
// Save or Discard. Pure: the storage is passed in, so tests use a fake.
import { LIMITS, TEMPLATE_KINDS } from "../../../lib/templates/types.ts";
import type { Draft } from "./templateForm.ts";

const PREFIX = "ai-os:template-draft:";
/** A forgotten draft is not offered back after this long. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface Stored {
  draft: Draft;
  /** `updatedAt` of the saved template this edit started from. */
  base: string;
  savedAt: number;
}

const key = (templateId: string) => `${PREFIX}${templateId}`;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

/** The stored value as a draft, or null if anything about it is off. */
export function parseDraft(value: unknown): Draft | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, LIMITS.name);
  const description = text(v.description, LIMITS.description);
  const subject = text(v.subject, LIMITS.subject);
  const to = text(v.to, LIMITS.address);
  const cc = text(v.cc, LIMITS.address);
  const body = text(v.body, LIMITS.body);
  const kind = TEMPLATE_KINDS.find((k) => k === v.kind);
  const id = v.id === null || typeof v.id === "string" ? v.id : undefined;
  const usedBy =
    Array.isArray(v.usedBy) &&
    v.usedBy.every((k) => typeof k === "string" && k.length < 100)
      ? (v.usedBy as string[]).slice(0, 50)
      : null;
  if (
    name === null ||
    description === null ||
    subject === null ||
    to === null ||
    cc === null ||
    body === null ||
    !kind ||
    id === undefined ||
    !usedBy
  ) {
    return null;
  }
  return {
    id,
    name,
    kind,
    description,
    subject,
    to,
    cc,
    body,
    usedBy,
    ...(typeof v.starterId === "string" ? { starterId: v.starterId } : {}),
  };
}

export function saveDraft(
  storage: DraftStorage | null,
  templateId: string,
  draft: Draft,
  base: string,
  now: number,
): void {
  if (!storage) return;
  try {
    const stored: Stored = { draft, base, savedAt: now };
    storage.setItem(key(templateId), JSON.stringify(stored));
  } catch {
    // Storage full or blocked: autosave is a convenience, never a failure.
  }
}

/** The kept draft for a template, if it is still current (same base, not too old). */
export function loadDraft(
  storage: DraftStorage | null,
  templateId: string,
  base: string,
  now: number,
): Draft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(templateId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored> | null;
    if (
      !stored ||
      stored.base !== base ||
      typeof stored.savedAt !== "number" ||
      now - stored.savedAt > DRAFT_MAX_AGE_MS
    ) {
      storage.removeItem(key(templateId));
      return null;
    }
    const draft = parseDraft(stored.draft);
    if (!draft || draft.id !== templateId) {
      storage.removeItem(key(templateId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage | null, templateId: string): void {
  try {
    storage?.removeItem(key(templateId));
  } catch {
    // Nothing to do.
  }
}

/** Whether the editor can say "Draft kept": there are unsaved edits and the template
 *  is a saved one (autosave runs only for those, not for a new template). */
export function isDraftKept(hasSavedTemplate: boolean, dirty: boolean): boolean {
  return hasSavedTemplate && dirty;
}
