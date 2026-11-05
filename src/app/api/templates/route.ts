import { readJsonBody, templatesHandler } from "@/lib/templates/http";
import { addTemplate, readTemplatesChecked, templatesDir } from "@/lib/templates/server";
import { STARTERS } from "@/lib/templates/starters";
import { TARGETS } from "@/lib/templates/targets";

export const dynamic = "force-dynamic";

/** GET /api/templates -> { ok, templates, targets, starters, dir, warning }. `warning` is a note when
 *  the library file held entries that had to be left out; a file that cannot be read at all answers
 *  `{ ok: false, code: "corrupt" }`. */
export function GET(request: Request) {
  return templatesHandler(request, async () => {
    const { library, warning } = await readTemplatesChecked();
    return {
      templates: library.templates,
      targets: TARGETS,
      starters: STARTERS,
      dir: templatesDir(),
      warning,
    };
  });
}

/** POST /api/templates { name, kind, subject, to, cc, body, usedBy, ... } -> { ok, template, displaced }. */
export function POST(request: Request) {
  return templatesHandler(request, async () => {
    const { template, displaced } = await addTemplate(await readJsonBody(request));
    return { template, displaced };
  });
}
