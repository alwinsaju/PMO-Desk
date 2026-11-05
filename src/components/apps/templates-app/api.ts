// Client of the app's own /api/templates routes (same origin; local files only).
// HTTP 200/4xx with an { ok, reason } envelope, like the other routes: a refusal
// is a value here, only a network failure throws.
import type { TemplateTarget } from "@/lib/templates/targets";
import type { Starter } from "@/lib/templates/starters";
import type { Displaced, Template, TemplateInput } from "@/lib/templates/types";

const BASE = "/api/templates";
const TIMEOUT_MS = 10_000;

export type Reply<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; fields?: Record<string, string>; code?: "corrupt" };

async function call<T extends object>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<Reply<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  try {
    return (await response.json()) as Reply<T>;
  } catch {
    return {
      ok: false,
      reason: `Unexpected reply from the app server (HTTP ${response.status}).`,
    };
  }
}

export interface LibraryPayload {
  templates: Template[];
  targets: TemplateTarget[];
  starters: Starter[];
  dir: string;
  /** A note when the library file held entries that had to be left out. */
  warning: string | null;
}

export const fetchLibrary = () => call<LibraryPayload>("");
export const createTemplate = (input: TemplateInput) =>
  call<{ template: Template; displaced: Displaced[] }>("", "POST", input);
export const saveTemplate = (id: string, input: TemplateInput) =>
  call<{ template: Template; displaced: Displaced[] }>(`/${id}`, "PUT", input);
export const deleteTemplate = (id: string) => call(`/${id}`, "DELETE");
export const restoreBuiltInTemplates = () =>
  call<{ added: number; rebuilt: boolean; backup: string | null }>(
    "/restore-built-in",
    "POST",
    {},
  );
/** Undo of a delete: the template comes back as it was. */
export const undeleteTemplate = (template: Template) =>
  call<{ template: Template; leftBehind: string[] }>("/undelete", "POST", { template });

/** The template a task or app uses, or null (also when the server cannot be reached,
 *  so the caller simply keeps its own wording). */
export async function fetchAssignedTemplate(
  targetKey: string,
  variant?: string | null,
): Promise<Template | null> {
  try {
    const reply = await call<{ template: Template | null }>(
      `/resolve?target=${encodeURIComponent(targetKey)}${variant ? `&variant=${encodeURIComponent(variant)}` : ""}`,
    );
    return reply.ok ? reply.template : null;
  } catch {
    return null;
  }
}
