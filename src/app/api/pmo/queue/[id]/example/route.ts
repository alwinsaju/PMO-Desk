import { saveProposalExample } from "@/lib/pmo/server/exampleActions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/example { draft } — save this proposal's message and
 *  the draft as the reviewer has it as a saved example for the structuring
 *  prompt. Creates no to-do and changes nothing in the queue. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => saveProposalExample(pmo, id, body));
}
