import { retryProposal } from "@/lib/pmo/server/actions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/retry — put a failed item back in the structuring queue. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, (pmo) => retryProposal(pmo, id));
}
