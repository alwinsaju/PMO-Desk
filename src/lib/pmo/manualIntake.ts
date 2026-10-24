// The "Paste" path: validation of what the paste dialog sends, and the
// pmo-intake/1 document built from it. Pure and client-safe (zod only), so the
// dialog can show the same errors the server would. The server half, which
// hashes, checks and writes the file, is server/manual.ts.
import { z } from "zod";

export const MANUAL_ORIGINS = ["manual", "teams", "outlook"] as const;
export type ManualOrigin = (typeof MANUAL_ORIGINS)[number];

/** Pasted text is capped well under the inbox's 1 MB file limit. The model
 *  only ever sees the first ~12k cleaned characters anyway. */
export const MAX_PASTE_CHARS = 100_000;
/** Request body cap for POST /api/pmo/intake/manual (UTF-8 bytes). */
export const MAX_PASTE_REQUEST_BYTES = 512 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .optional()
    .transform((value) => value ?? "");

export const ManualPasteSchema = z.object({
  subject: optionalText(300),
  from: optionalText(300),
  body: z
    .string("Paste the message text.")
    .max(
      MAX_PASTE_CHARS,
      `At most ${MAX_PASTE_CHARS.toLocaleString("en-GB")} characters.`,
    )
    .refine((value) => value.trim() !== "", { message: "Paste the message text." }),
  origin: z.enum(MANUAL_ORIGINS).optional().default("manual"),
  link: z
    .string()
    .trim()
    .max(2000, "At most 2000 characters.")
    .refine((value) => value === "" || /^(https:\/\/\S+|outlook:\S+)$/i.test(value), {
      message: "A link must start with https:// (or outlook:).",
    })
    .optional()
    .transform((value) => value ?? ""),
});
export type ManualPaste = z.output<typeof ManualPasteSchema>;
export type ManualPasteInput = z.input<typeof ManualPasteSchema>;

/** "Name <a@b.com>", "a@b.com" or a plain name. */
export function parseSender(from: string): { name?: string; address?: string } {
  const text = from.trim();
  if (!text) return {};
  const angled = /^(.*?)\s*<\s*([^<>\s@]+@[^<>\s]+)\s*>$/.exec(text);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    return { ...(name ? { name } : {}), address: angled[2] };
  }
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(text)) return { address: text };
  return { name: text };
}

/** The pmo-intake/1 document for a paste. `source` is always "manual" (the
 *  user vouches for it, see filter.ts); where the text really came from is
 *  kept in context.origin. */
export function buildManualIntake(
  paste: ManualPaste,
  sourceId: string,
  receivedAt: string,
) {
  return {
    schema: "pmo-intake/1" as const,
    producer: "manual-paste",
    source: "manual" as const,
    sourceId,
    receivedAt,
    sender: parseSender(paste.from),
    subject: paste.subject,
    body: { text: paste.body, format: "text" as const },
    context: { origin: paste.origin },
    ...(paste.link ? { link: paste.link } : {}),
  };
}
