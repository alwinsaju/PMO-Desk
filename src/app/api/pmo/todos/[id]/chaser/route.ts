import { discardChaserDraft, startChaserDraft } from "@/lib/pmo/server/actions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/todos/[id]/chaser — start drafting a follow-up with the LOCAL
 *  model. Returns at once; the draft appears in GET /api/pmo/state (`chasers`)
 *  when the model has written it. It is text to review and copy: nothing is
 *  sent by this app. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, (pmo) => startChaserDraft(pmo, id));
}

/** DELETE /api/pmo/todos/[id]/chaser — forget a finished or failed draft. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, async (pmo) => discardChaserDraft(pmo, id));
}
