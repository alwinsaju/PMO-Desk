// PMO first run, server side: finish the wizard (save who the person is, which
// mail counts as work mail and which folder is the inbox) and, on request,
// create the PMO-Inbox folder. Nothing here creates a folder or reads a user
// folder on its own: only an explicit call does, after the same sanity rules the
// Setup screen uses (setup/inbox.ts).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FirstRunBodySchema,
  loginNameHint,
  splitList,
  suggestedFullName,
} from "../firstRun.ts";
import { fieldErrors, summarizeFieldErrors, type FieldError } from "../fieldErrors.ts";
import { parseDomainList, parseEmailList } from "../listValidation.ts";
import {
  INBOX_FOLDER_NAME,
  inboxFolderProblem,
  inboxSuggestions,
  oneDriveFacts,
  validateInboxChoice,
  type InboxSafetyFacts,
} from "../../setup/inbox.ts";
import { inboxSafetyFacts, isDirectory } from "../../setup/inboxFs.ts";
import type { PmoConfig } from "../types.ts";
import type { ActionResult, Pmo } from "./actions.ts";

type Env = Record<string, string | undefined>;

/** The computer, injected so tests never touch a real user folder. */
export interface FirstRunDeps {
  env: Env;
  isDirectory: (path: string) => boolean;
  isAbsolute: (path: string) => boolean;
  /** Creates one folder (its parent must exist). */
  mkdir: (path: string) => Promise<void>;
  safety: InboxSafetyFacts;
}

export function realFirstRunDeps(dataRoot: string): FirstRunDeps {
  return {
    env: process.env,
    isDirectory,
    isAbsolute: path.isAbsolute,
    mkdir: async (dir) => void (await mkdir(dir)),
    safety: inboxSafetyFacts(dataRoot),
  };
}

type Refusal = {
  ok: false;
  reason: string;
  needsConfirmation?: true;
  errors?: FieldError[];
};
const refuse = (
  reason: string,
  extra: { needsConfirmation?: true; errors?: FieldError[] } = {},
): Refusal => ({
  ok: false,
  reason,
  ...extra,
});

const envInbox = (env: Env) => env.AI_OS_PMO_INBOX_DIR?.trim() || undefined;

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0];
  return `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`;
};

const uniqueNames = (values: string[]) =>
  splitList(values.map((v) => v.trim()).join(","), { commasOnly: true });

/** Finish the wizard. Only while setup is not complete: afterwards, changes go
 *  through Settings. The inbox folder is validated like Setup's (and a
 *  folder holding other JSON needs `confirmNonEmpty`). Emails and domains are
 *  checked entry by entry (listValidation.ts): a bad one refuses the whole
 *  request, naming it in `errors`. */
export async function completeFirstRun(
  pmo: Pick<Pmo, "store">,
  body: unknown,
  deps: FirstRunDeps,
): Promise<ActionResult<{ config: PmoConfig }> | Refusal> {
  const parsed = FirstRunBodySchema.safeParse(body);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error, body);
    return refuse(`Invalid setup: ${summarizeFieldErrors(errors)}`, { errors });
  }
  const input = parsed.data;

  let inboxDir: string | null = null; // null = keep what is saved (the environment fixes it)
  if (!envInbox(deps.env)) {
    const chosen = validateInboxChoice(input.inboxDir, deps.isDirectory, deps.isAbsolute);
    if (!chosen.ok) return refuse(chosen.reason);
    const problem = inboxFolderProblem(
      chosen.path,
      deps.safety,
      input.confirmNonEmpty === true,
    );
    if (problem)
      return refuse(
        problem.reason,
        problem.needsConfirmation ? { needsConfirmation: true } : {},
      );
    inboxDir = chosen.path;
  }

  return pmo.store.withLock(async () => {
    const current = await pmo.store.loadConfig();
    if (current.setupComplete) {
      return refuse("Setup is already complete. Change these in Settings.");
    }
    const next: PmoConfig = {
      ...current,
      setupComplete: true,
      timeZone: input.timeZone,
      reminders: { ...current.reminders, timeZone: input.timeZone },
      me: { names: uniqueNames(input.names), emails: parseEmailList(input.emails).valid },
      allowedSenderDomains: parseDomainList(input.allowedSenderDomains).valid,
      blockedDomains: parseDomainList(input.blockedDomains).valid,
      inboxDir: inboxDir ?? current.inboxDir,
    };
    await pmo.store.saveConfig(next);
    await pmo.store.audit("config", { changed: ["setup"] });
    return { ok: true as const, config: next };
  });
}

const SetInboxBodySchema = z.object({
  inboxDir: z.string().trim().min(1, "Choose the inbox folder.").max(500),
  confirmNonEmpty: z.boolean().optional(),
});

/** Settings > "Inbox folder": the same checks the wizard applies (full path, an
 *  existing folder, not a drive, user, system or PMO Desk folder; a folder holding
 *  other JSON needs `confirmNonEmpty`), then saved. Takes effect on the next scan. */
export async function setInboxFolder(
  pmo: Pick<Pmo, "store">,
  body: unknown,
  deps: FirstRunDeps,
): Promise<ActionResult<{ config: PmoConfig }> | Refusal> {
  if (envInbox(deps.env)) {
    return refuse(
      "The inbox folder is set by the AI_OS_PMO_INBOX_DIR setting and cannot be changed here.",
    );
  }
  const parsed = SetInboxBodySchema.safeParse(body);
  if (!parsed.success) return refuse(firstIssue(parsed.error));
  const chosen = validateInboxChoice(
    parsed.data.inboxDir,
    deps.isDirectory,
    deps.isAbsolute,
  );
  if (!chosen.ok) return refuse(chosen.reason);
  const problem = inboxFolderProblem(
    chosen.path,
    deps.safety,
    parsed.data.confirmNonEmpty === true,
  );
  if (problem) {
    return refuse(
      problem.reason,
      problem.needsConfirmation ? { needsConfirmation: true } : {},
    );
  }
  return pmo.store.withLock(async () => {
    const current = await pmo.store.loadConfig();
    const next: PmoConfig = { ...current, inboxDir: chosen.path };
    await pmo.store.saveConfig(next);
    await pmo.store.audit("config", { changed: ["inboxDir"] });
    return { ok: true as const, config: next };
  });
}

const CreateFolderBodySchema = z.object({
  /** Where PMO-Inbox goes: the folder the person picked or a OneDrive root. */
  parent: z.string().trim().min(1, "Choose where to create the folder.").max(500),
  confirmNonEmpty: z.boolean().optional(),
});

/** Create `<parent>\PMO-Inbox` (or reuse it when it is already there). Nothing
 *  is saved: the wizard keeps the path until the person finishes. */
export async function createInboxFolder(
  body: unknown,
  deps: FirstRunDeps,
): Promise<ActionResult<{ path: string; created: boolean }> | Refusal> {
  if (envInbox(deps.env)) {
    return refuse(
      "The inbox folder is set by the AI_OS_PMO_INBOX_DIR setting and cannot be changed here.",
    );
  }
  const parsed = CreateFolderBodySchema.safeParse(body);
  if (!parsed.success) return refuse(firstIssue(parsed.error));
  const parent = validateInboxChoice(
    parsed.data.parent,
    deps.isDirectory,
    deps.isAbsolute,
  );
  if (!parent.ok) return refuse(parent.reason);

  const target = path.join(parent.path, INBOX_FOLDER_NAME);
  const problem = inboxFolderProblem(
    target,
    deps.safety,
    parsed.data.confirmNonEmpty === true,
  );
  if (problem)
    return refuse(
      problem.reason,
      problem.needsConfirmation ? { needsConfirmation: true } : {},
    );

  if (deps.isDirectory(target)) return { ok: true, path: target, created: false };
  try {
    await deps.mkdir(target);
  } catch (error) {
    return refuse(
      `Could not create the folder: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ok: true, path: target, created: true };
}

export interface FirstRunSuggestions {
  /** From the Windows user name; the person edits it. */
  /** Pre-filled only when the Windows login looks like a first and last name. */
  fullName: string;
  /** The login as a name ("Alsaju"), for the placeholder when it is not pre-filled. */
  nameHint: string;
  inbox: {
    /** Set when AI_OS_PMO_INBOX_DIR fixes the inbox: the wizard shows it and asks nothing. */
    fromEnvironment: string | null;
    oneDriveSignedIn: boolean;
    /** PMO-Inbox inside each OneDrive root; `exists` false = the button creates it. */
    suggestions: { path: string; parent: string; exists: boolean }[];
  };
}

export function firstRunSuggestions(deps: FirstRunDeps): FirstRunSuggestions {
  const oneDrive = oneDriveFacts(deps.env, deps.isDirectory);
  return {
    fullName: suggestedFullName(deps.env),
    nameHint: loginNameHint(deps.env),
    inbox: {
      fromEnvironment: envInbox(deps.env) ? path.resolve(envInbox(deps.env)!) : null,
      oneDriveSignedIn: oneDrive.signedIn,
      suggestions: inboxSuggestions(oneDrive, "", deps.isDirectory).map((suggested) => ({
        path: suggested,
        parent: path.dirname(suggested),
        exists: deps.isDirectory(suggested),
      })),
    },
  };
}
