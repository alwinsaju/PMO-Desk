// Stand-in for the local model, for unit tests and for running the app with
// PMO_AI_STUB=1 (previews, demos) without Ollama. A few markers in the message
// body trigger the failure paths the real model can hit:
//   [[stub-timeout]]   -> AiRuntimeError("timeout")
//   [[stub-invalid]]   -> AiRuntimeError("invalid-output")
//   [[stub-bad-quote]] -> an answer whose quote is not in the message
//   [[stub-unrelated]] -> (updates) "this is about something else"
//   [[stub-signoff:approved|approved_with_conditions|changes_requested|rejected|
//     unclear|not_a_signoff]] -> (updates of a to-do awaiting a sign-off) that
//     classification; without a marker the reply is read by simple wording rules.
//     The server's own guards (quote check, hostile wording) still apply to it.
// and a file named `stub-runtime-down` in the data directory makes every call
// fail as "runtime-down" until it is deleted (the "stop the model" switch).
//
// All five tasks answer deterministically from the prompt text:
//   generate        message -> to-do proposal
//   generateUpdate  new message + existing to-do -> what changed (reply / new
//                   date / new action / new info / nothing)
//   draftChaser     a short polite follow-up built from the facts block
//   draftSignoffRequest  a short sign-off request built from the facts block
//   draftNarrative  weekly-report highlights / risks / next week, from the facts
import { existsSync } from "node:fs";
import path from "node:path";
import { AiNarrativeSchema } from "../reportNarrative.ts";
import {
  AiStructuredSchema,
  AiUpdateSchema,
  SIGNOFF_CLASSES,
  type SignoffClass,
} from "../types.ts";
import type { Generator } from "./structure.ts";

function runtimeError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = "AiRuntimeError";
  (error as Error & { code: string }).code = code;
  return error;
}

const FYI = /\b(fyi|for your information|no action|newsletter|unsubscribe)\b/i;
const THANKS_ONLY =
  /^\s*(thanks|thank you|ok|okay|noted|cheers|great)\b[^.?!]{0,40}[.!]?\s*$/i;
const DELIVERED =
  /\b(attached|here (is|are)|done|completed|sent (it|them|over)|i have sent|confirmed|approved|signed off)\b/i;
const NEW_ASK =
  /\b(could you (also )?|can you (also )?|please (also )?|also,? please)\b/i;

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

const bodyOf = (prompt: string) =>
  /<message [^>]*>\n([\s\S]*?)\n<\/message>/.exec(prompt)?.[1] ?? prompt;

const SIGNOFF_MARKER = /\[\[stub-signoff:([a-z_]+)\]\]/;
const SO_REJECT =
  /\b(reject\w*|declin\w*|not approv\w*|cannot approve|can'?t approve|won'?t approve|do not approve)\b/i;
const SO_CHANGES =
  /\b(please (change|update|fix|revise|amend|correct|add|remove)|needs? to be (changed|updated|fixed|revised|reworked)|can you (change|update|fix|revise))\b/i;
const SO_CONDITIONS =
  /\b(subject to|provided that|as long as|on condition|only if|once (you|the)|before (we|i) (proceed|sign|go))\b/i;
const SO_APPROVE = /\b(approved?|sign(ed)?[- ]?off|happy to proceed|go ahead|lgtm)\b/i;
const SO_VAGUE =
  /\b(looks (good|fine|great)|thanks|thank you|noted|will (take a )?look|got it)\b/i;

/** The stub's reading of a reply to a sign-off request. */
function stubSignoff(
  lines: string[],
  body: string,
): { signoff: SignoffClass; quote: string; reason: string } {
  const marked = SIGNOFF_MARKER.exec(body)?.[1];
  const fixed = SIGNOFF_CLASSES.find((c) => c === marked);
  const pick = (pattern: RegExp) =>
    lines.find((line) => pattern.test(line)) ?? lines[0] ?? "";
  let signoff: SignoffClass;
  let pattern: RegExp;
  if (SO_REJECT.test(body)) [signoff, pattern] = ["rejected", SO_REJECT];
  else if (SO_CHANGES.test(body)) [signoff, pattern] = ["changes_requested", SO_CHANGES];
  else if (SO_CONDITIONS.test(body))
    [signoff, pattern] = ["approved_with_conditions", SO_CONDITIONS];
  else if (SO_APPROVE.test(body)) [signoff, pattern] = ["approved", SO_APPROVE];
  else if (SO_VAGUE.test(body)) [signoff, pattern] = ["unclear", SO_VAGUE];
  else [signoff, pattern] = ["not_a_signoff", /./];
  if (fixed) {
    signoff = fixed;
    pattern = {
      approved: SO_APPROVE,
      approved_with_conditions: SO_CONDITIONS,
      changes_requested: SO_CHANGES,
      rejected: SO_REJECT,
      unclear: SO_VAGUE,
      not_a_signoff: /./,
    }[fixed];
  }
  return {
    signoff,
    quote: signoff === "not_a_signoff" ? "" : pick(pattern).slice(0, 250),
    reason: `Stub reading: ${signoff.replace(/_/g, " ")}.`,
  };
}

export function createStubGenerator(
  options: { dataDir?: string; delayMs?: number } = {},
): Generator {
  /** The delay, the "model is down" switch and the failure markers. */
  async function gate(prompt: string, text: string): Promise<void> {
    if (options.delayMs)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.dataDir && existsSync(path.join(options.dataDir, "stub-runtime-down"))) {
      throw runtimeError("runtime-down", "Could not reach the local AI runtime (stub).");
    }
    if (text.includes("[[stub-timeout]]") || prompt.includes("[[stub-timeout]]")) {
      throw runtimeError(
        "timeout",
        "The local AI model did not answer within 1s (stub).",
      );
    }
    if (text.includes("[[stub-invalid]]") || prompt.includes("[[stub-invalid]]")) {
      throw runtimeError(
        "invalid-output",
        "The local AI model did not return valid output (stub).",
      );
    }
  }

  return {
    model: () => "stub",

    async generate({ prompt }) {
      const body = bodyOf(prompt);
      await gate(prompt, body);

      const first = body.split(/(?<=[.!?])\s+|\n/).find((line) => line.trim()) ?? body;
      const sentence = first.trim().slice(0, 250);
      const actionable = !FYI.test(body);
      const day = /\b(\d{4}-\d{2}-\d{2})\b/.exec(body)?.[1] ?? null;
      return AiStructuredSchema.parse({
        reason: actionable
          ? "The message asks for something to be done."
          : "Informational only.",
        isActionable: actionable,
        confidence: actionable ? 0.8 : 0.9,
        title: actionable ? sentence.slice(0, 80) : "No action needed",
        description: sentence,
        owner: { name: "Alwin Saju", email: "alsaju@deloitte.com", isMe: true },
        requester: { name: null, email: null },
        dueAt: day,
        dueBasis: day ? "explicit" : "none",
        priority: /urgent|asap/i.test(body) ? "high" : "normal",
        actionItems: actionable
          ? [{ text: sentence.slice(0, 120), owner: null, dueAt: null }]
          : [],
        checkpointTemplate: "simple",
        // Lets a preview show the waiting UX straight from an approved proposal.
        waitingOn: /\[\[stub-waiting:([^\]]{1,60})\]\]/.exec(body)?.[1]?.trim() ?? null,
        tags: ["stub"],
        quote: body.includes("[[stub-bad-quote]]")
          ? "This sentence does not appear anywhere in the message."
          : sentence,
      });
    },

    async generateUpdate({ prompt, signoff: signoffMode }) {
      const body = bodyOf(prompt);
      await gate(prompt, body);

      const lines = sentences(body);
      const clean = (line: string) => line.replace(/\[\[[^\]]*\]\]/g, "").trim();
      const main = clean(lines.find((line) => clean(line)) ?? body).slice(0, 250);
      const todoBlock = /<todo>\n([\s\S]*?)\n<\/todo>/.exec(prompt)?.[1] ?? "";
      const waitingOn = /^waiting on: (.+)$/m.exec(todoBlock)?.[1]?.trim() ?? "nobody";
      const currentDue = /^due: (\S+)$/m.exec(todoBlock)?.[1] ?? "none";
      const day = /\b(\d{4}-\d{2}-\d{2})\b/.exec(body)?.[1] ?? null;
      const newDue = day && day !== currentDue ? day : null;
      const delivered = DELIVERED.test(body);
      const unrelated = body.includes("[[stub-unrelated]]");
      const nothing = !unrelated && (THANKS_ONLY.test(body) || FYI.test(body));
      const ask = NEW_ASK.test(body)
        ? lines.find((line) => NEW_ASK.test(line))
        : undefined;

      let kind:
        "unrelated" | "reply" | "new-info" | "new-action" | "due-change" | "nothing" =
        "new-info";
      if (unrelated) kind = "unrelated";
      else if (nothing) kind = "nothing";
      else if (waitingOn !== "nobody" && delivered) kind = "reply";
      else if (newDue) kind = "due-change";
      else if (ask) kind = "new-action";

      // A to-do that awaits a sign-off: classify the reply too.
      const reading = signoffMode
        ? stubSignoff(lines.map(clean).filter(Boolean), body)
        : null;
      const answers =
        !!reading &&
        reading.signoff !== "unclear" &&
        reading.signoff !== "not_a_signoff" &&
        !unrelated;
      if (answers && waitingOn !== "nobody") kind = "reply";
      const actionable = kind !== "unrelated" && kind !== "nothing";
      return AiUpdateSchema.parse({
        ...(reading
          ? {
              signoffReason: reading.reason,
              signoff: reading.signoff,
              signoffQuote: body.includes("[[stub-bad-quote]]")
                ? "This sentence does not appear anywhere in the message."
                : reading.quote,
            }
          : {}),
        reason: unrelated
          ? "The message is about a different subject."
          : nothing
            ? "Only an acknowledgement."
            : "The message adds to the to-do.",
        kind,
        summary: nothing ? "Acknowledgement only." : main,
        clearsWaiting: actionable && waitingOn !== "nobody" && (delivered || answers),
        newDueAt: actionable ? newDue : null,
        newActionItems:
          actionable && ask && kind !== "reply"
            ? [{ text: clean(ask).slice(0, 120), owner: null, dueAt: null }]
            : [],
        note: actionable ? main.slice(0, 200) : null,
        quote: body.includes("[[stub-bad-quote]]")
          ? "This sentence does not appear anywhere in the message."
          : main,
      });
    },

    async draftChaser({ prompt }) {
      await gate(prompt, prompt);
      const field = (label: string) =>
        new RegExp(`^${label}: (.+)$`, "m").exec(prompt)?.[1]?.trim() ?? "";
      const waitingOn = field("Waiting on") || "there";
      const title = field("Title") || "this";
      const waited = field("Waited so far");
      const first = waitingOn.split(/[\s(,]/)[0] || waitingOn;
      return [
        `Hi ${first},`,
        "",
        `Just checking in on "${title}"${waited ? `: it has been ${waited} since I asked` : ""}. Could you let me know where things stand when you get a moment?`,
        "",
        "Thanks,",
        "Alwin",
      ].join("\n");
    },

    // A short sign-off request from the facts block (sign-off request dialog).
    async draftSignoffRequest({ prompt }) {
      await gate(prompt, prompt);
      const field = (label: string) =>
        new RegExp(`^${label}: (.+)$`, "m").exec(prompt)?.[1]?.trim() ?? "";
      const approver = field("Approver");
      const first =
        approver && !approver.startsWith("(") ? approver.split(/[\s(,]/)[0] : "";
      const due = field("Due date");
      return [
        first ? `Hi ${first},` : "Hi,",
        "",
        `Please could you review and sign off "${field("Title") || "this"}"${due && due !== "none" ? ` by ${due}` : ""}? A short reply confirming your approval, or telling me what to change, is all I need.`,
        "",
        "Thanks,",
        "Alwin",
      ].join("\n");
    },

    // The weekly report's narrative, written from the facts block the prompt
    // carries (reportNarrative.ts): a plain sentence per part, quoting titles
    // exactly. `[[stub-invent]]` in a title makes it also name a person and a
    // project that are not in the data, to exercise the verifier.
    async draftNarrative({ prompt }) {
      await gate(prompt, prompt);
      const facts = /<facts>\n([\s\S]*?)\n<\/facts>/.exec(prompt)?.[1] ?? prompt;
      const part = (
        heading: string,
      ): { title: string; fields: Record<string, string> }[] => {
        const found = new RegExp(`^${heading} \\((\\d+)\\)\\n((?:- .*\\n?)*)`, "m").exec(
          `${facts}\n`,
        );
        return (found?.[2] ?? "")
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .map((line) => {
            const [first, ...rest] = line.slice(2).split(" | ");
            return {
              title: first.replace(/^"|"$/g, ""),
              fields: Object.fromEntries(
                rest.map((piece) => {
                  const at = piece.indexOf(": ");
                  return at < 0 ? [piece, ""] : [piece.slice(0, at), piece.slice(at + 2)];
                }),
              ),
            };
          });
      };
      const count = (heading: string) =>
        Number(new RegExp(`^${heading} \\((\\d+)\\)`, "m").exec(facts)?.[1] ?? 0);

      const completed = part("COMPLETED THIS PERIOD");
      const overdue = part("OVERDUE");
      const waiting = part("WAITING ON OTHERS");
      const decisions = part("NEEDS A DECISION");
      const due = part("DUE IN THE NEXT 7 DAYS");

      const highlights = completed.length
        ? [
            `Closed ${count("COMPLETED THIS PERIOD")} ${count("COMPLETED THIS PERIOD") === 1 ? "item" : "items"}, including "${completed[0].title}".`,
          ]
        : ["Nothing to report."];
      const risks = [
        ...(overdue.length
          ? [
              `${count("OVERDUE")} overdue, the longest being "${overdue[0].title}" (${overdue[0].fields.days_overdue} days).`,
            ]
          : []),
        ...(waiting.length
          ? [
              `Waiting on ${waiting[0].fields.waiting_on} for "${waiting[0].title}" since ${waiting[0].fields.since}.`,
            ]
          : []),
        ...(decisions.length
          ? [`A decision is pending on "${decisions[0].title}".`]
          : []),
      ];
      const nextWeek = due.length
        ? [`Focus on "${due[0].title}", due ${due[0].fields.due}.`]
        : ["Nothing to report."];
      if (facts.includes("[[stub-invent]]")) {
        highlights.push("Rahul Verma closed the vendor contract ahead of plan.");
        nextWeek.push('Start "Project Phoenix" on 2026-12-31.');
      }
      return AiNarrativeSchema.parse({
        highlights,
        risks: risks.length ? risks : ["Nothing to report."],
        nextWeek,
      });
    },
  };
}
