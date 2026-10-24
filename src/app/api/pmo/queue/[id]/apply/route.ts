import { approveUpdate } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/apply { include? } — the ONLY route that applies an
 *  "update to existing to-do" (the human-ticked changes), and links the new
 *  message into that to-do's history. Nothing is sent anywhere. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => approveUpdate(pmo, id, body));
}
