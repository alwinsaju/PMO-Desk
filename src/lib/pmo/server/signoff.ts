// The sign-off actions (phase 6): the ONLY code that writes a sign-off request,
// an outcome or a stamp. Like approve, they take the request body as `unknown`,
// validate it and return the { ok, reason? } envelope the routes send back.
//
// Identity and time come from here, never from the client: `recordedBy` is the OS
// user of the machine running the server (the same source as `approvedBy` and
// every audit line, mirroring how the task platform stamps approvals, see
// tasks/TASK-PLATFORM-CONTRACT.md), and `recordedAt` is the server's clock. A
// body that tries to send either (or any other server-owned field) is REFUSED,
// and the attempt is audit-logged. Nothing here sends anything: "request" records
// that the person says they sent it.
import {
  SERVER_OWNED_MESSAGE,
  SignoffConfirmBodySchema,
  SignoffRecordBodySchema,
  SignoffRequestBodySchema,
  SignoffRevokeBodySchema,
  confirmConditions,
  recordSignoff,
  requestSignoff,
  revokeSignoff,
  serverOwnedKeysIn,
  type SignoffResult,
} from "../signoff.ts";
import type { ChaserJob, Todo } from "../types.ts";
import type { ActionResult, Pmo } from "./actions.ts";
import { osUser } from "./store.ts";
import { z } from "zod";

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

type Parsed<S extends z.ZodType> = { data: z.output<S> } | { reason: string };

/** Refuse any server-owned field outright (`allowed` lists the ones an action
 *  legitimately takes), then validate strictly: an unknown key is an error too. */
async function parseBody<S extends z.ZodType>(
  pmo: Pmo,
  todoId: string,
  route: string,
  schema: S,
  body: unknown,
  allowed: readonly string[] = [],
): Promise<Parsed<S>> {
  const owned = serverOwnedKeysIn(body, allowed);
  if (owned.length > 0) {
    await pmo.store.audit("signoff-refused", {
      todoId,
      route,
      via: "body",
      fields: owned,
    });
    return { reason: `${SERVER_OWNED_MESSAGE} Remove: ${owned.join(", ")}.` };
  }
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return { reason: `Invalid request: ${firstIssue(parsed.error)}` };
  return { data: parsed.data };
}

/** Run one pure sign-off transition on a to-do under the store lock and persist
 *  it with its audit line. `by` and `now` are the server's. */
async function transition(
  pmo: Pmo,
  todoId: string,
  action: Parameters<Pmo["store"]["audit"]>[0],
  run: (
    todo: Todo,
    ctx: { now: string; by: string },
  ) => Promise<SignoffResult> | SignoffResult,
): Promise<ActionResult<{ todo: Todo }>> {
  return pmo.store.withLock(async () => {
    const todo = await pmo.store.getTodo(todoId);
    if (!todo) return fail("That to-do no longer exists.");
    const result = await run(todo, { now: pmo.now().toISOString(), by: osUser() });
    if (!result.ok) return fail(result.reason);
    await pmo.store.putTodo(result.todo);
    await pmo.store.audit(action, { todoId, ...result.audit });
    return { ok: true as const, todo: result.todo };
  });
}

/** "I've sent it": the person marked the request as sent. Records when and by
 *  whom, the approver, waiting-on (so the chaser reminders work) and ticks
 *  "Sent for sign-off". */
export async function requestSignoffAction(
  pmo: Pmo,
  todoId: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const parsed = await parseBody(pmo, todoId, "request", SignoffRequestBodySchema, body);
  if ("reason" in parsed) return fail(parsed.reason);
  const { checkpointId, approver } = parsed.data;
  const done = await transition(pmo, todoId, "signoff-request", (todo, ctx) =>
    requestSignoff(todo, { checkpointId, approver, ...ctx }),
  );
  if (done.ok) pmo.signoffDrafts.discard(todoId);
  return done;
}

/** Record the answer: outcome, conditions and where it came from. */
export async function recordSignoffAction(
  pmo: Pmo,
  todoId: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const parsed = await parseBody(pmo, todoId, "record", SignoffRecordBodySchema, body, [
    "outcome",
  ]);
  if ("reason" in parsed) return fail(parsed.reason);
  const { checkpointId, outcome, conditions, note, intakeId } = parsed.data;
  return transition(pmo, todoId, "signoff-record", async (todo, ctx) => {
    // A linked message must belong to this to-do (its source or a message linked
    // into its timeline), so the evidence cannot point at someone else's mail.
    let evidence = {
      intakeId: null as string | null,
      messageLink: null as string | null,
    };
    if (intakeId) {
      const belongs =
        intakeId === todo.source.intakeId ||
        (todo.history ?? []).some((entry) => entry.intakeId === intakeId);
      const raw = belongs ? await pmo.store.readRaw(intakeId) : null;
      if (!raw) return fail("That message is not part of this to-do.");
      evidence = { intakeId, messageLink: raw.intake.link ?? null };
    }
    return recordSignoff(todo, {
      checkpointId,
      outcome,
      conditions,
      evidence: { ...evidence, note: note ?? "" },
      ...ctx,
    });
  });
}

/** A person confirms the conditions of an "approved with conditions" are met. */
export async function confirmSignoffConditionsAction(
  pmo: Pmo,
  todoId: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const parsed = await parseBody(
    pmo,
    todoId,
    "conditions",
    SignoffConfirmBodySchema,
    body,
  );
  if ("reason" in parsed) return fail(parsed.reason);
  const { checkpointId } = parsed.data;
  return transition(pmo, todoId, "signoff-conditions-met", (todo, ctx) =>
    confirmConditions(todo, { checkpointId, ...ctx }),
  );
}

/** The only undo of a recorded sign-off. A reason is required. */
export async function revokeSignoffAction(
  pmo: Pmo,
  todoId: string,
  body: unknown,
): Promise<ActionResult<{ todo: Todo }>> {
  const parsed = await parseBody(pmo, todoId, "revoke", SignoffRevokeBodySchema, body);
  if ("reason" in parsed) return fail(parsed.reason);
  const { checkpointId, reason } = parsed.data;
  return transition(pmo, todoId, "signoff-revoke", (todo, ctx) =>
    revokeSignoff(todo, { checkpointId, reason, ...ctx }),
  );
}

// --- the optional local-model version of the request text (copy-only) -------------

const DraftBodySchema = z.strictObject({
  approver: z.string().trim().max(200).nullable().optional(),
});

export async function startSignoffDraft(
  pmo: Pmo,
  todoId: string,
  body: unknown,
): Promise<ActionResult<{ job: ChaserJob }>> {
  const parsed = DraftBodySchema.safeParse(body ?? {});
  if (!parsed.success) return fail(`Invalid request: ${firstIssue(parsed.error)}`);
  const result = await pmo.signoffDrafts.start(todoId, parsed.data.approver ?? null);
  if (result.ok) await pmo.store.audit("signoff-draft", { todoId });
  return result;
}

export function discardSignoffDraft(pmo: Pmo, todoId: string): ActionResult {
  pmo.signoffDrafts.discard(todoId);
  return { ok: true };
}
