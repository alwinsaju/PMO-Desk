import { stageEdits } from "@/lib/pmo/server/actions";
import { handle, readBody } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** PATCH /api/pmo/queue/[id] { draft } — save the reviewer's in-progress edits
 *  (the AI draft itself is never modified). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await readBody(request);
  return handle(request, (pmo) => stageEdits(pmo, id, body));
}
