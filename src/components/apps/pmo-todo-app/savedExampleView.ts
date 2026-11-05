// What a row of the Saved examples dialog says about where the example came from (pure; see
// savedExampleView.test.mjs). A saved example keeps the email SUBJECT and the cleaned message
// body, never the sender, so the row must not say "From".
import type { SavedExample } from "../../../lib/pmo/savedExamples.ts";

const MAX_LABEL = 90;

const clip = (text: string) =>
  text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1).trimEnd()}…` : text;

/** The email subject when there is one, else the start of the message. */
export function exampleLabel(example: Pick<SavedExample, "subject" | "message">): string {
  return clip(example.subject.trim() || example.message.replace(/\s+/g, " ").trim());
}

/** "Subject: ..." for an email, "Message: ..." when only the text was saved. */
export function exampleSourceLine(
  example: Pick<SavedExample, "subject" | "message">,
): string {
  return `${example.subject.trim() ? "Subject" : "Message"}: ${exampleLabel(example)}`;
}
