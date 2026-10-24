import { requestSignoffAction } from "@/lib/pmo/server/signoff";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/todos/[id]/signoff/request { checkpointId?, approver? } — the person says they sent the sign-off request. Origin-checked, zod-validated and audit-logged; who and when are set by
 *  the server, and a body that sends them is refused. Nothing is sent anywhere. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => requestSignoffAction(pmo, id, body));
}
