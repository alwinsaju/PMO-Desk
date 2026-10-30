// The first-run wizard remembers two things in this browser's storage (never sent
// anywhere): where you were, so closing the window does not restart it, and who you are,
// so a fresh data folder does not ask for your name and address again. Pure: the
// storage is passed in.
import {
  FIRST_RUN_STEPS,
  type FirstRunForm,
  type FirstRunStepId,
  withSuggestedDomain,
} from "./firstRun.ts";

export type WizardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PROGRESS_KEY = "ai-os:pmo-wizard-progress";
const PROFILE_KEY = "ai-os:pmo-wizard-profile";
/** Unfinished progress older than this starts over. */
export const PROGRESS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const FORM_FIELDS = [
  "fullName",
  "otherNames",
  "email",
  "timeZone",
  "allowedDomains",
  "blockedDomains",
  "inboxDir",
] as const satisfies readonly (keyof FirstRunForm)[];

/** Identity answers that make sense on another data folder (not the folder itself). */
const PROFILE_FIELDS = [
  "fullName",
  "otherNames",
  "email",
  "timeZone",
  "allowedDomains",
  "blockedDomains",
] as const satisfies readonly (keyof FirstRunForm)[];

const MAX_FIELD = 600;

function readFields(
  value: unknown,
  fields: readonly (keyof FirstRunForm)[],
): Partial<FirstRunForm> | null {
  if (typeof value !== "object" || value === null) return null;
  const out: Partial<FirstRunForm> = {};
  for (const field of fields) {
    const v = (value as Record<string, unknown>)[field];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.length > MAX_FIELD) return null;
    out[field] = v;
  }
  return out;
}

function read(storage: WizardStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storage: WizardStorage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience: the wizard works without it.
  }
}

export interface WizardProgress {
  step: number;
  form: FirstRunForm;
}

export function saveProgress(
  storage: WizardStorage | null,
  progress: WizardProgress,
  now: number,
): void {
  write(storage, PROGRESS_KEY, { ...progress, savedAt: now });
}

/** Where the wizard was left, or null (none, too old, or unreadable). Starts from `base`. */
export function loadProgress(
  storage: WizardStorage | null,
  base: FirstRunForm,
  now: number,
): WizardProgress | null {
  const stored = read(storage, PROGRESS_KEY) as {
    step?: unknown;
    form?: unknown;
    savedAt?: unknown;
  } | null;
  if (!stored || typeof stored.savedAt !== "number") return null;
  if (now - stored.savedAt > PROGRESS_MAX_AGE_MS) return null;
  const fields = readFields(stored.form, FORM_FIELDS);
  const step = stored.step;
  if (!fields || typeof step !== "number" || !Number.isInteger(step)) return null;
  if (step < 0 || step >= FIRST_RUN_STEPS.length) return null;
  const form = { ...base, ...fields };
  // Nothing answered and still on the first step: there is nothing to resume.
  if (step === 0 && FORM_FIELDS.every((field) => form[field] === base[field]))
    return null;
  return { step, form };
}

export function clearProgress(storage: WizardStorage | null): void {
  try {
    storage?.removeItem(PROGRESS_KEY);
  } catch {
    // Nothing to do.
  }
}

/** Keep who you are for the next data folder. */
export function saveProfile(storage: WizardStorage | null, form: FirstRunForm): void {
  const profile: Partial<FirstRunForm> = {};
  for (const field of PROFILE_FIELDS) profile[field] = form[field];
  write(storage, PROFILE_KEY, profile);
}

/** Fill the blank answers from the remembered identity; what is already typed stays. */
export function withRememberedProfile(
  storage: WizardStorage | null,
  form: FirstRunForm,
): FirstRunForm {
  const profile = readFields(read(storage, PROFILE_KEY), PROFILE_FIELDS);
  if (!profile) return form;
  const next = { ...form };
  for (const field of PROFILE_FIELDS) {
    if (!next[field].trim() && profile[field]?.trim()) next[field] = profile[field]!;
  }
  return next;
}

/**
 * "Skip for now" on a step that has a sensible default: take the suggestion and go on.
 * Returns null for a step that cannot be skipped (who you are, the inbox folder).
 */
export function skippedStepForm(
  step: FirstRunStepId,
  form: FirstRunForm,
  detectedTimeZone: string,
): FirstRunForm | null {
  switch (step) {
    case "timeZone":
      return form.timeZone.trim() || !detectedTimeZone
        ? form
        : { ...form, timeZone: detectedTimeZone };
    case "domains":
      return withSuggestedDomain(form);
    default:
      return null;
  }
}
