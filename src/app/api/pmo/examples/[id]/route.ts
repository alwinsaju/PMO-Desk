import { removeSavedExample } from "@/lib/pmo/server/exampleActions";
import { handle } from "@/lib/pmo/server/http";

export const dynamic = "force-dynamic";

/** DELETE /api/pmo/examples/[id] — remove one saved example for good. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, (pmo) => removeSavedExample(pmo, id));
}
