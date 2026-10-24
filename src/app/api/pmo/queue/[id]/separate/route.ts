import { separateUpdate } from "@/lib/pmo/server/actions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/queue/[id]/separate — "Create as separate to-do instead": the
 *  update card becomes an ordinary proposal and is structured as a new to-do. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, (pmo) => separateUpdate(pmo, id));
}
