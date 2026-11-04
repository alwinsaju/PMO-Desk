// The request handling of POST /api/registers/suggest, kept out of the route file so tests can
// run it with a fake or stub model: the same-origin guard, a small body cap, the { ok, reason }
// envelope. It reads and writes no register data; the answer is a suggestion for the person to
// edit in the form and save themselves.
import { guardApiRequest } from "../security/apiGuard.ts";
import { BodyTooLargeError, readTextBounded } from "../security/boundedBody.ts";
import {
  SuggestError,
  suggestForRegister,
  suggestFailure,
  type SuggestGenerator,
} from "./registerSuggest.ts";

/** A form's values are small; 64 KB is generous. */
export const MAX_SUGGEST_BODY = 64 * 1024;

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** `makeGenerator` is called per request, so the stub switch (an environment variable) is read when used. */
export async function handleSuggestRequest(
  request: Request,
  makeGenerator: () => SuggestGenerator,
): Promise<Response> {
  const verdict = guardApiRequest(request);
  if (!verdict.ok) return json({ ok: false, reason: verdict.reason }, 403);
  try {
    let body: unknown;
    try {
      body = JSON.parse(await readTextBounded(request, MAX_SUGGEST_BODY));
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        throw new SuggestError("The request is too large.", 413);
      throw new SuggestError("The request body must be JSON.");
    }
    const result = await suggestForRegister(body, makeGenerator());
    return json({ ok: true, ...result });
  } catch (error) {
    const failure = suggestFailure(error);
    // Only the status and kind are logged: never a prompt, a field or the model's text.
    // (The model being down or slow is normal here and has its own plain reason; not logged.)
    if (failure.status === 500 && !(error instanceof SuggestError))
      console.error(
        "[registers] suggestion failed:",
        error instanceof Error ? error.name : "error",
        failure.status,
      );
    return json({ ok: false, reason: failure.reason }, failure.status);
  }
}
