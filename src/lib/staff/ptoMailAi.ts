// The real PTO reader: the local AI runtime (src/lib/ai-runtime), which talks only to
// Ollama on 127.0.0.1, the same one the PMO To-Do uses. Kept apart from the rest of the
// PTO code because it needs the app's module aliases; tests inject a fake classifier.
import { clampTimeoutMs, generateJson, getLightModelIfInstalled } from "@/lib/ai-runtime";
import {
  PtoReadingSchema,
  buildPtoSystemPrompt,
  buildPtoUserPrompt,
  type PtoReading,
} from "./ptoMail.ts";
import { syncPtoMail, type PtoClassifier } from "./ptoMailServer.ts";

/** A short email is quick even on CPU; clamped below Node fetch's 300 s silence limit. */
const TIMEOUT_MS = clampTimeoutMs(Number(process.env.AI_OS_PTO_AI_TIMEOUT_MS) || 180_000);

const kindWords: Record<PtoReading["kind"], string> = {
  pto: "PTO",
  "comp-off": "comp off",
  sick: "sick leave",
  cancel: "a cancellation",
  "not-leave": "not a leave email",
};

const ISO_DAYS = /\b\d{4}-\d{2}-\d{2}\b/g;
const SICK = /\b(sick|unwell|fever|doctor)\b/i;
const COMP = /\b(comp(?:ensatory)?[\s-]*off|c[\s-]?off|time off in lieu)\b/i;

/** AI_OS_PTO_AI_STUB=1: a keyword reader for demos and tests that must not wait for
 *  the model. It understands only dates written as 2026-11-05. */
function createStubClassifier(): PtoClassifier {
  return async (message) => {
    const text = `${message.subject}\n${message.text}`;
    const days = text.match(ISO_DAYS) ?? [];
    const sentence =
      text
        .split(/(?<=[.!?\n])\s*/)
        .find((s) => /\d{4}-\d{2}-\d{2}/.test(s) || COMP.test(s) || SICK.test(s)) ?? "";
    return {
      kind: COMP.test(text)
        ? "comp-off"
        : SICK.test(text)
          ? "sick"
          : days.length
            ? "pto"
            : "not-leave",
      startDate: days[0] ?? null,
      endDate: days[days.length - 1] ?? null,
      partialDay: /\bhalf[\s-]?day\b/i.test(text),
      confidence: days.length ? "high" : "low",
      quote: sentence.trim().slice(0, 300),
      reason: "Read by the demo keyword reader.",
    };
  };
}

export function createPtoClassifier(): PtoClassifier {
  if (process.env.AI_OS_PTO_AI_STUB?.trim()) return createStubClassifier();
  return async (message, today) =>
    generateJson({
      system: buildPtoSystemPrompt(),
      prompt: buildPtoUserPrompt(message, today),
      schema: PtoReadingSchema,
      timeoutMs: TIMEOUT_MS,
      // The light model reads these unattended in the background (a short email needs
      // nothing bigger, and it loads fast); without it, the model chosen in Settings.
      model: await getLightModelIfInstalled(),
      // No reasoning phase: the structured answer needs none and it is 3-10x slower on CPU.
      think: false,
      log: {
        task: "pto-email",
        label: message.subject,
        note: (r) => `read as ${kindWords[r.kind]}`,
      },
    });
}

/** Starts a scan of the PTO-Inbox in the background (the model is slow, so callers do
 *  not wait); a scan already running is joined. Never throws. */
export function kickPtoSync(): void {
  void syncPtoMail(createPtoClassifier()).catch((error) =>
    console.error("[staff] PTO email scan failed:", error),
  );
}
