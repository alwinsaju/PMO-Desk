import { patchTodo } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** PATCH /api/pmo/todos/[id] — edit fields, toggle action items, move a
 *  checkpoint, mark done/cancelled. Finishing the last checkpoint only sets
 *  `offerDone` in the reply; the to-do is never closed on its own. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => patchTodo(pmo, id, body));
}
