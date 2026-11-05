// Slash shortcuts for the command bar: "/todo buy milk Fri", "/open staff", "/overdue".
// A slash command is only a shorter way to type a sentence the bar already understands:
// it is rewritten to that sentence and handed to the same routers as typed text
// (resolveOpenIntent, resolveLocalIntent, resolvePmoIntent). There is no new AI path:
// a slash command whose sentence those routers do not recognise is answered with its
// usage instead of being sent to the model, and an unknown one gets "did you mean".
// Pure (no React, no stores).
import { closestWord } from "./didYouMean.ts";
import { resolveLocalIntent } from "./localIntent.ts";
import { resolvePmoIntent } from "./pmoIntent.ts";
import { appIdFromName, knownAppNames, resolveOpenIntent } from "./windowIntent.ts";

export interface SlashCommand {
  /** Typed as "/name". */
  name: string;
  /** Other spellings of the same command. */
  aliases: readonly string[];
  /** What to type, e.g. "/todo <what> [day]". */
  usage: string;
  /** One short line for the suggestion chip. */
  summary: string;
  /** The command takes text after its name. */
  takesText: boolean;
  /** The sentence the bar already understands, or null when `args` do not fit. */
  build: (args: string) => string | null;
}

/** In the order they are suggested when only "/" has been typed. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "todo",
    aliases: ["task", "remind"],
    usage: "/todo <what> [day]",
    summary: "add a to-do",
    takesText: true,
    build: (args) => (args ? `remind me to ${args}` : null),
  },
  {
    name: "open",
    aliases: ["go"],
    usage: "/open <app>",
    summary: "open an app",
    takesText: true,
    build: (args) => (args ? `open ${args}` : null),
  },
  {
    name: "overdue",
    aliases: [],
    usage: "/overdue",
    summary: "what is overdue",
    takesText: false,
    build: () => "what's overdue?",
  },
  {
    name: "chasers",
    aliases: [],
    usage: "/chasers",
    summary: "what needs chasing",
    takesText: false,
    build: () => "what do I need to chase?",
  },
  {
    name: "todos",
    aliases: ["mine"],
    usage: "/todos",
    summary: "my open to-dos",
    takesText: false,
    build: () => "show my open to-dos",
  },
  {
    name: "off",
    aliases: ["away"],
    usage: "/off [day]",
    summary: "who is off",
    takesText: true,
    build: (args) => `who's off ${args || "this week"}?`,
  },
  {
    name: "status",
    aliases: ["pmo"],
    usage: "/status",
    summary: "PMO status",
    takesText: false,
    build: () => "PMO status",
  },
  {
    name: "changes",
    aliases: [],
    usage: "/changes [since]",
    summary: "what changed",
    takesText: true,
    build: (args) => `what changed since ${args || "yesterday"}?`,
  },
  {
    name: "back",
    aliases: [],
    usage: "/back <person>",
    summary: "when someone is back",
    takesText: true,
    build: (args) => (args ? `when is ${args} back?` : null),
  },
  {
    name: "snooze",
    aliases: [],
    usage: "/snooze <to-do> [to day]",
    summary: "snooze a to-do",
    takesText: true,
    build: (args) => (args ? `snooze ${args}` : null),
  },
  {
    name: "done",
    aliases: [],
    usage: "/done <to-do>",
    summary: "mark a to-do done",
    takesText: true,
    build: (args) => (args ? `mark ${args} done` : null),
  },
  {
    name: "chase",
    aliases: [],
    usage: "/chase <person> on <to-do>",
    summary: "draft a chaser",
    takesText: true,
    build: (args) => (args ? `chase ${args}` : null),
  },
  {
    name: "focus",
    aliases: [],
    usage: "/focus [minutes | off]",
    summary: "focus mode",
    takesText: true,
    build: (args) => {
      if (!args) return "focus";
      if (/^(?:off|stop|end)$/i.test(args)) return "stop focus";
      return /^\d{1,3}$/.test(args) ? `focus for ${args} minutes` : null;
    },
  },
  {
    name: "explain",
    aliases: [],
    usage: "/explain",
    summary: "explain this screen",
    takesText: false,
    build: () => "explain this screen",
  },
];

/** Every spelling, for "did you mean" ("/help" and a bare "/" list the commands in a notice). */
const allNames = (): string[] => [
  ...SLASH_COMMANDS.flatMap((c) => [c.name, ...c.aliases]),
  "help",
];

function findCommand(name: string): SlashCommand | undefined {
  const key = name.toLowerCase();
  return SLASH_COMMANDS.find((c) => c.name === key || c.aliases.includes(key));
}

/** What the bar does with a slash command. */
export type SlashResult =
  /** Not a slash command (or not one we own): carry on exactly as before. */
  | { kind: "none" }
  /** Run this sentence through the usual routers (it is known to be understood by one). */
  | { kind: "run"; prompt: string; command: string }
  /** Show this plain message and run nothing. */
  | { kind: "say"; text: string };

const SLASH = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i;

/** True when the bar's text is meant as a slash command (or is starting one). */
export function isSlashInput(value: string): boolean {
  return value.trimStart().startsWith("/");
}

/** Whether the existing routers understand `prompt` without the model. */
function understood(prompt: string): boolean {
  return Boolean(
    resolveOpenIntent(prompt) || resolveLocalIntent(prompt) || resolvePmoIntent(prompt),
  );
}

function helpText(): string {
  const list = SLASH_COMMANDS.map((c) => `/${c.name}`).join(", ");
  return `Slash commands: ${list}. Type / to see what each does.`;
}

/** The nearest command name to a mistyped one: a unique prefix, else a close spelling. */
function nearestCommand(name: string): string | null {
  const key = name.toLowerCase();
  const prefixed = SLASH_COMMANDS.filter((c) => c.name.startsWith(key));
  if (key.length >= 2 && prefixed.length === 1) return prefixed[0].name;
  const near = closestWord(key, allNames());
  return near ? (findCommand(near)?.name ?? near) : null;
}

/**
 * Reads the bar's text on Enter. Anything that does not start like "/word" (including
 * paths like "/usr/bin" and a lone "/ ") is `none`, so a normal question is untouched.
 */
export function resolveSlash(text: string): SlashResult {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed === "/") return { kind: "say", text: helpText() };
  const match = SLASH.exec(trimmed);
  if (!match) return { kind: "none" };
  const name = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();

  if (name === "help") return { kind: "say", text: helpText() };

  const command = findCommand(name);
  if (!command) {
    const near = nearestCommand(name);
    return {
      kind: "say",
      text: near
        ? `There is no /${name} command. Did you mean /${near}? Type / to see them all.`
        : `There is no /${name} command. Type / to see them all.`,
    };
  }

  const prompt = command.build(args);
  if (command.name === "open" && prompt) {
    // "/open staf": say which app was meant instead of asking the model what "staf" is.
    if (!appIdFromName(args)) {
      const near = closestWord(args.toLowerCase(), knownAppNames());
      return {
        kind: "say",
        text: near
          ? `I don't know an app called "${args}". Did you mean /open ${near}?`
          : `I don't know an app called "${args}". Try ${command.usage}, for example /open staff.`,
      };
    }
  }
  if (!prompt || !understood(prompt)) {
    return { kind: "say", text: `Usage: ${command.usage}` };
  }
  return { kind: "run", prompt, command: command.name };
}

export interface SlashSuggestion {
  /** What a click or Tab puts in the bar (a command that takes text ends in a space). */
  text: string;
  /** Short muted line beside it. */
  hint: string;
}

/** Suggestions while "/" is being typed: commands that start with the typed word (all of
 *  them for a bare "/"), else the closest spelling. Nothing once arguments are typed. */
export function slashSuggestions(
  typed: string,
  limit = SLASH_COMMANDS.length,
): SlashSuggestion[] {
  const text = typed.trimStart();
  const match = /^\/([a-z0-9?-]*)(\s[\s\S]*)?$/i.exec(text);
  if (!match || match[2] !== undefined) return [];
  const word = match[1].toLowerCase();
  const suggest = (commands: readonly SlashCommand[]): SlashSuggestion[] =>
    commands.slice(0, limit).map((c) => ({
      text: c.takesText ? `/${c.name} ` : `/${c.name}`,
      hint: c.summary,
    }));

  const starts = SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(word) || c.aliases.some((a) => a.startsWith(word)),
  );
  // A fully typed command with no arguments yet is already what the person means.
  if (starts.length === 1 && starts[0].name === word && !starts[0].takesText) return [];
  if (starts.length > 0) return suggest(starts);
  const near = word ? nearestCommand(word) : null;
  const command = near ? findCommand(near) : undefined;
  return command ? suggest([command]) : [];
}
