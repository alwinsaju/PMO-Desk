import { clearCancelledTodos } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/todos/clear-cancelled { ids? } -> { removed } — delete cancelled
 *  to-dos for good (all of them, or just `ids`). Done and open to-dos are never touched. */
export async function POST(request: Request) {
  const body = await readBody(request);
  return handle(request, (pmo) => clearCancelledTodos(pmo, body));
}
