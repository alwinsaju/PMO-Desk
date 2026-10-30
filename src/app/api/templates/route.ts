import { readJsonBody, templatesHandler } from "@/lib/templates/http";
import { addTemplate, readTemplates, templatesDir } from "@/lib/templates/server";
import { STARTERS } from "@/lib/templates/starters";
import { TARGETS } from "@/lib/templates/targets";

export const dynamic = "force-dynamic";

/** GET /api/templates -> { ok, templates, targets, starters, dir }. */
export function GET(request: Request) {
  return templatesHandler(request, async () => ({
    templates: (await readTemplates()).templates,
    targets: TARGETS,
    starters: STARTERS,
    dir: templatesDir(),
  }));
}

/** POST /api/templates { name, kind, subject, to, cc, body, usedBy, ... } -> { ok, template, displaced }. */
export function POST(request: Request) {
  return templatesHandler(request, async () => {
    const { template, displaced } = await addTemplate(await readJsonBody(request));
    return { template, displaced };
  });
}
