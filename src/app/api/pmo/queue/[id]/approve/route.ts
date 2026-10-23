import { approveProposal } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/approve { draft } — the ONLY route that creates a
 *  to-do from a proposal. The body is the human-reviewed draft. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => approveProposal(pmo, id, body));
}
