import { readJsonBody, templatesHandler } from "@/lib/templates/http";
import { TEMPLATE_ID } from "@/lib/templates/library";
import { removeTemplate, saveTemplate, TemplateError } from "@/lib/templates/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function idOf(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!TEMPLATE_ID.test(id))
    throw new TemplateError("That template does not exist.", 404);
  return id;
}

/** PUT /api/templates/<id> (the whole template) -> { ok, template, displaced }. */
export function PUT(request: Request, context: Context) {
  return templatesHandler(request, async () => {
    const id = await idOf(context);
    const { template, displaced } = await saveTemplate(id, await readJsonBody(request));
    return { template, displaced };
  });
}

/** DELETE /api/templates/<id> -> { ok }. Whatever used it goes back to its own wording. */
export function DELETE(request: Request, context: Context) {
  return templatesHandler(request, async () => {
    await removeTemplate(await idOf(context));
    return {};
  });
}
