import { rejectProposal } from "@/lib/pmo/server/actions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/reject — dismisses the proposal; creates nothing. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, (pmo) => rejectProposal(pmo, id));
}
