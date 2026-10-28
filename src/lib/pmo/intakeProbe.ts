// Tells a pmo-intake file (valid or broken) from any other JSON that happens to
// sit in the inbox folder. Pure; shared by the ingest and the setup folder check.
const SCHEMA_ID = /^pmo-intake(\/|$)/;
// Fallback for text that does not parse (cut off mid-write, or a stray comma).
const SCHEMA_FIELD = /"schema"\s*:\s*"pmo-intake(\/|")/;

/** True when the text is, or was clearly meant to be, a pmo-intake document:
 *  its `schema` field names pmo-intake. Anything else is foreign and must never
 *  be moved or deleted by the ingest. */
export function looksLikeIntake(text: string): boolean {
  const body = text.replace(/^\uFEFF/, "");
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return false;
    const schema = (parsed as { schema?: unknown }).schema;
    return typeof schema === "string" && SCHEMA_ID.test(schema);
  } catch {
    return SCHEMA_FIELD.test(body);
  }
}
