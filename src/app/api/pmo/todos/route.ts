import { createManualTodo } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/todos { draft, proposalId? } — create a to-do by hand (the
 *  human is the reviewer). With `proposalId` it replaces a queue item the
 *  model could not structure. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => createManualTodo(pmo, body));
}
