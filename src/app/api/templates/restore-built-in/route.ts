import { templatesHandler } from "@/lib/templates/http";
import { restoreBuiltIn } from "@/lib/templates/server";

export const dynamic = "force-dynamic";

/** POST /api/templates/restore-built-in -> { ok, added, rebuilt, backup }. Rebuilds a library file that
 *  cannot be read (keeping a .bak copy), or adds back the built-in templates a readable one lacks. */
export function POST(request: Request) {
  return templatesHandler(request, async () => ({ ...(await restoreBuiltIn()) }));
}
