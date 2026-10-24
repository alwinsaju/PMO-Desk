import { discardSignoffDraft, startSignoffDraft } from "@/lib/pmo/server/signoff";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** POST /api/pmo/todos/[id]/signoff/draft { approver? } — start the optional
 *  "improve with AI" version of the sign-off request with the LOCAL model.
 *  Returns at once; the draft appears in GET /api/pmo/state (`signoffDrafts`).
 *  It is text to review and copy: nothing is sent, and the to-do is unchanged. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => startSignoffDraft(pmo, id, body));
}

/** DELETE /api/pmo/todos/[id]/signoff/draft — forget a finished or failed draft. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, async (pmo) => discardSignoffDraft(pmo, id));
}
