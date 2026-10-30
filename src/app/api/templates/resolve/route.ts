import { templatesHandler } from "@/lib/templates/http";
import { resolveTemplate, TemplateError } from "@/lib/templates/server";
import { targetByKey } from "@/lib/templates/targets";

export const dynamic = "force-dynamic";

/** GET /api/templates/resolve?target=<key> -> { ok, template: Template | null }:
 *  the template that task or app uses, if one is set. */
export function GET(request: Request) {
  return templatesHandler(request, async () => {
    const key = new URL(request.url).searchParams.get("target") ?? "";
    const variant = new URL(request.url).searchParams.get("variant");
    if (!targetByKey(key)) throw new TemplateError("Unknown place for a template.", 404);
    return { template: await resolveTemplate(key, process.env, variant) };
  });
}
