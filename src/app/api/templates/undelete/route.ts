import { readJsonBody, templatesHandler } from "@/lib/templates/http";
import { restoreDeleted } from "@/lib/templates/server";

export const dynamic = "force-dynamic";

/** POST /api/templates/undelete { template } -> { ok, template, leftBehind }. Puts a deleted template
 *  back as it was; places another template has taken since stay with that template. */
export function POST(request: Request) {
  return templatesHandler(request, async () => ({
    ...(await restoreDeleted(await readJsonBody(request))),
  }));
}
