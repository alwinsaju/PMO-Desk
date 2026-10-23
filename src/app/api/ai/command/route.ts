import { NextResponse } from "next/server";
import { z } from "zod";
import { getAiRuntimeConfig } from "@/lib/ai-runtime";
import type {
  AiCommandAppId,
  AiCommandRequest,
  AiCommandRequestNote,
  AiCommandResult,
  NoteToolName,
  WindowToolName,
} from "./types";

// Always a live call to a local model process — never safe to treat as
// static/cacheable content.
export const dynamic = "force-dynamic";

/**
 * This route is the ONLY thing that ever talks to Ollama. Client JS never
 * calls Ollama directly and never even learns its URL — CommandBar.tsx
 * only ever calls this same-origin route. That's the same architectural
 * boundary agent-office/* already keeps (its FastAPI backend's URL is only
 * ever read from server code that proxies/launches it — see
 * agent-office/shared.ts), applied here even though, same as there, there's
 * no API key to protect: it's the right shape regardless, and it's what
 * lets OLLAMA_BASE_URL change (a different machine, a tunnel, whatever)
 * without touching a single client bundle.
 *
 * Overridable via env vars (OLLAMA_BASE_URL, OLLAMA_MODEL) for a machine
 * where Ollama runs somewhere other than the default, or has a different
 * model pulled. Both now come from the shared local AI runtime config
 * (src/lib/ai-runtime), so one setting drives every AI feature. This route
 * still talks to Ollama itself rather than through generateJson/generateText:
 * it needs `/api/chat` tool calling and the un-queued 60s latency behavior
 * below, which those helpers don't offer.
 */
const {
  baseUrl: OLLAMA_BASE_URL,
  defaultModel: OLLAMA_MODEL,
  numCtx,
} = getAiRuntimeConfig();

/**
 * Real local inference latency varies a LOT on this hardware — a cold
 * model load alone took ~12-18s during manual verification, on top of
 * whatever the actual generation takes. Generous on purpose so a
 * slow-but-alive request doesn't get killed early, while still bounded so
 * a genuinely hung request fails within a predictable window instead of
 * hanging the command bar forever (see CommandBar.tsx's "thinking" state).
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Fixed allowlist this route validates every tool-call decision against
 * before it's ever returned to the client as something to execute — the
 * model's raw output is never trusted/forwarded as-is. Only offered to
 * Ollama at all when the focused app is Notes (see `POST` below); every
 * other app gets no `tools` array, i.e. no action capability yet.
 */
const NOTE_TOOL_NAMES: readonly NoteToolName[] = [
  "create_note",
  "update_note",
  "delete_note",
];
const WINDOW_TOOL_NAMES: readonly WindowToolName[] = [
  "open_app",
  "focus_window",
  "minimize_window",
  "maximize_window",
  "close_window",
];
const AI_APP_IDS: readonly AiCommandAppId[] = [
  "files",
  "notes",
  "browser",
  "tasks",
  "app-store",
];

function isNoteToolName(value: string): value is NoteToolName {
  return (NOTE_TOOL_NAMES as readonly string[]).includes(value);
}

function isWindowToolName(value: string): value is WindowToolName {
  return (WINDOW_TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * Standard OpenAI-style function-calling shape — verified empirically
 * (2026-08-27, against this exact Ollama install/model) that `/api/chat`
 * accepts a `tools` array in exactly this shape and, when the model decides
 * to call one, returns `message.tool_calls[].function.{name,arguments}`
 * with `arguments` as an ALREADY-PARSED JSON object (not a string to
 * `JSON.parse` yourself, unlike OpenAI's own Chat Completions API) — see
 * `readToolArguments` below, which still defensively handles the string
 * form too in case a future Ollama/model-template combination differs.
 */
const NOTE_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_note",
      description:
        "Create a new note with the given text content. Use this when the user asks to create, add, jot down, or write a new note.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The full text content of the new note. The note's title is automatically taken from its first line, so start the content with a short descriptive first line.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description:
        "Replace the ENTIRE content of an existing note, identified by id. Use this when the user asks to edit, update, change, rewrite, or add to an existing note they refer to by name or topic.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "The id of the existing note to update, from the list provided below.",
          },
          content: {
            type: "string",
            description:
              "The complete new text content that replaces the note's current content. You are only told this note's title, not its current body, so compose the full replacement text yourself from the user's instruction.",
          },
        },
        required: ["id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description:
        "Delete an existing note, identified by id. Use this when the user asks to delete, remove, or get rid of an existing note they refer to by name or topic.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "The id of the existing note to delete, from the list provided below.",
          },
        },
        required: ["id"],
      },
    },
  },
] as const;

const WINDOW_TOOLS = [
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Open a built-in desktop app when the user asks to open or launch it.",
      parameters: {
        type: "object",
        properties: { appId: { type: "string", enum: AI_APP_IDS } },
        required: ["appId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "focus_window",
      description: "Focus an existing desktop window by its id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "minimize_window",
      description: "Minimize an existing desktop window by its id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "maximize_window",
      description:
        "Maximize an existing desktop window by its id. Calling it again restores its previous size.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_window",
      description: "Close an existing desktop window by its id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
] as const;

const requestSchema = z.object({
  prompt: z.string().trim().min(1),
  focusedApp: z.object({
    id: z.string().min(1),
    title: z.string(),
  }),
  notes: z.array(z.object({ id: z.string().min(1), title: z.string() })).optional(),
  windows: z.array(
    z.object({ id: z.string().min(1), appId: z.string().min(1), title: z.string() }),
  ),
});

const createNoteArgsSchema = z.object({ content: z.string().min(1) });
const updateNoteArgsSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
});
const deleteNoteArgsSchema = z.object({ id: z.string().min(1) });
const windowIdArgsSchema = z.object({ id: z.string().min(1) });
const openAppArgsSchema = z.object({ appId: z.enum(AI_APP_IDS) });

/**
 * POST /api/ai/command -> AiCommandResult (see types.ts). Accepts the
 * command bar's raw prompt plus which app is focused; calls the local
 * Ollama model server-side; returns either a validated tool-call decision,
 * a plain conversational reply, or a typed error. Never throws to the
 * client as a bare 500 for an expected failure (Ollama down, a timeout, a
 * response that didn't parse) — those all come back as a normal 200 with
 * `{ type: "error", ... }`, mirroring agent-office/start/route.ts's own
 * `{ok: false, reason}` convention. A 400 is reserved for a genuinely
 * malformed REQUEST (a bug in this route's own client, not an Ollama/model
 * problem).
 */
export async function POST(request: Request) {
  let body: AiCommandRequest;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        type: "error",
        kind: "malformed",
        message: "Malformed request.",
      } satisfies AiCommandResult,
      { status: 400 },
    );
  }

  const notesEnabled = body.focusedApp.id === "notes";
  const existingNotes = notesEnabled ? (body.notes ?? []) : [];

  const ollamaRequest = {
    model: OLLAMA_MODEL,
    stream: false,
    // Favor consistent tool-use/argument formatting over creative
    // conversational variety — this is a command surface, not a chat
    // companion, and a lower temperature measurably helped this 7B model
    // pick the right tool during manual verification.
    // num_ctx matches the shared runtime's: a different value would make
    // Ollama reload the model every time the command bar and another AI
    // feature alternate.
    options: { temperature: 0.2, num_ctx: numCtx },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(
          body.focusedApp.title,
          notesEnabled,
          existingNotes,
          body.windows,
        ),
      },
      { role: "user", content: body.prompt },
    ],
    tools: notesEnabled ? [...WINDOW_TOOLS, ...NOTE_TOOLS] : WINDOW_TOOLS,
  };

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json({
      type: "error",
      kind: isTimeout ? "timeout" : "unreachable",
      message: isTimeout
        ? `The local AI model didn't respond within ${REQUEST_TIMEOUT_MS / 1000}s. It may be busy — try again.`
        : `Couldn't reach the local AI model at ${OLLAMA_BASE_URL}. Make sure Ollama is running and that ${OLLAMA_MODEL} is pulled.`,
    } satisfies AiCommandResult);
  }

  if (!response.ok) {
    return NextResponse.json({
      type: "error",
      kind: "unreachable",
      message: `Ollama responded with an error (HTTP ${response.status}).`,
    } satisfies AiCommandResult);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return NextResponse.json({
      type: "error",
      kind: "malformed",
      message: "The local AI model returned a response that wasn't valid JSON.",
    } satisfies AiCommandResult);
  }

  return NextResponse.json(interpretOllamaResponse(payload, existingNotes, body.windows));
}

function buildSystemPrompt(
  focusedAppTitle: string,
  notesEnabled: boolean,
  existingNotes: AiCommandRequestNote[],
  windows: AiCommandRequest["windows"],
): string {
  const sections = [
    `You are the AI assistant built into this desktop OS's command bar. The user currently has the "${focusedAppTitle}" app focused.`,
    "You can manage desktop windows with the provided tools. Call exactly one window tool when the user asks to open, launch, focus, minimize, maximize, restore, or close an app/window. To act on an existing window, use its exact id from the list below. Do not claim an action succeeded unless you called its tool.",
    windows.length > 0
      ? `Open windows:\n${windows.map((window) => `- id: ${window.id} - ${window.title} (${window.appId})`).join("\n")}`
      : "There are no open windows.",
  ];

  if (notesEnabled) {
    sections.push(
      "You have tools to create, update, or delete notes. Call exactly one tool ONLY when the user is clearly asking you to create, edit, update, rewrite, delete, or remove a note. For anything else — questions, conversation, or requests unrelated to a note action — reply normally with a short plain text message and do NOT call a tool.",
      "When updating or deleting a note, match the user's description against the titles listed below and use that note's exact id. If nothing plausibly matches, don't guess at an id — either create a new note instead if that fits the request, or ask a clarifying question as a plain text reply.",
      existingNotes.length > 0
        ? `Existing notes:\n${existingNotes.map((n) => `- id: ${n.id} — title: "${n.title}"`).join("\n")}`
        : "There are currently no existing notes.",
    );
  } else {
    sections.push(
      "For app-content tasks, explain briefly that direct content editing is currently available in Notes only. You can still manage desktop windows with the provided tools.",
    );
  }

  return sections.join("\n\n");
}

function interpretOllamaResponse(
  payload: unknown,
  existingNotes: AiCommandRequestNote[],
  windows: AiCommandRequest["windows"],
): AiCommandResult {
  const message = isRecord(payload) ? payload.message : undefined;
  if (!isRecord(message)) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model's response had no message.",
    };
  }

  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return interpretToolCall(toolCalls[0], existingNotes, windows);
  }

  const content = message.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return { type: "message", text: content.trim() };
  }

  return {
    type: "error",
    kind: "malformed",
    message: "The local AI model returned an empty response.",
  };
}

function interpretToolCall(
  rawCall: unknown,
  existingNotes: AiCommandRequestNote[],
  windows: AiCommandRequest["windows"],
): AiCommandResult {
  const fn = isRecord(rawCall) ? rawCall.function : undefined;
  if (!isRecord(fn)) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model's tool call was malformed.",
    };
  }

  const name = fn.name;
  if (typeof name !== "string" || (!isNoteToolName(name) && !isWindowToolName(name))) {
    return {
      type: "error",
      kind: "malformed",
      message: `The local AI model tried to call an unknown tool ("${String(name)}").`,
    };
  }

  const args = readToolArguments(fn.arguments);
  if (args === undefined) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model's tool arguments weren't valid JSON.",
    };
  }

  return isNoteToolName(name)
    ? validateNoteAction(name, args, existingNotes)
    : validateWindowAction(name, args, windows);
}

/**
 * Every real response observed while building this route (including
 * multiple live re-checks against this exact Ollama/model combo) returned
 * `function.arguments` as an already-parsed JSON object — NOT a
 * JSON-encoded string the way OpenAI's own Chat Completions API shapes
 * function-call arguments. This still handles the string form defensively
 * (returning `undefined` on unparseable JSON) in case a future Ollama
 * version or a different model's chat template ever differs — better to
 * handle both cheaply than to assume the empirically-verified shape holds
 * forever.
 */
function readToolArguments(rawArgs: unknown): Record<string, unknown> | undefined {
  if (isRecord(rawArgs)) return rawArgs;
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function validateNoteAction(
  name: NoteToolName,
  args: Record<string, unknown>,
  existingNotes: AiCommandRequestNote[],
): AiCommandResult {
  const knownIds = new Set(existingNotes.map((n) => n.id));

  if (name === "create_note") {
    const parsed = createNoteArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        type: "error",
        kind: "malformed",
        message: "The local AI model called create_note with invalid arguments.",
      };
    }
    return { type: "action", name: "create_note", arguments: parsed.data };
  }

  if (name === "update_note") {
    const parsed = updateNoteArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        type: "error",
        kind: "malformed",
        message: "The local AI model called update_note with invalid arguments.",
      };
    }
    if (!knownIds.has(parsed.data.id)) {
      return {
        type: "error",
        kind: "malformed",
        message: "The local AI model tried to update a note that doesn't exist.",
      };
    }
    return { type: "action", name: "update_note", arguments: parsed.data };
  }

  const parsed = deleteNoteArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model called delete_note with invalid arguments.",
    };
  }
  if (!knownIds.has(parsed.data.id)) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model tried to delete a note that doesn't exist.",
    };
  }
  return { type: "action", name: "delete_note", arguments: parsed.data };
}

function validateWindowAction(
  name: WindowToolName,
  args: Record<string, unknown>,
  windows: AiCommandRequest["windows"],
): AiCommandResult {
  if (name === "open_app") {
    const parsed = openAppArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        type: "error",
        kind: "malformed",
        message: "The local AI model called open_app with invalid arguments.",
      };
    }
    return { type: "action", name, arguments: parsed.data };
  }

  const parsed = windowIdArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      type: "error",
      kind: "malformed",
      message: `The local AI model called ${name} with invalid arguments.`,
    };
  }
  if (!windows.some((window) => window.id === parsed.data.id)) {
    return {
      type: "error",
      kind: "malformed",
      message: "The local AI model tried to control a window that doesn't exist.",
    };
  }
  return { type: "action", name, arguments: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
