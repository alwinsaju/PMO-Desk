import { restoreProposal } from "@/lib/pmo/server/actions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/restore — undoes a reject: the item goes back to the
 *  review queue (ready, or pending when the model has still to read it). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, async (pmo) => {
    const result = await restoreProposal(pmo, id);
    if (result.ok) void pmo.worker.kick().catch(() => undefined);
    return result;
  });
}
