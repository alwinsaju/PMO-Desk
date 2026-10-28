// Types shared by the server runtime and the model log dialog. Type-only: safe
// to import from client components (nothing here runs).
import type { LoadedModel } from "./core.ts";
import type { ActiveCall, AiLogEvent } from "./log.ts";
import type { ServerLogTail } from "./serverLog.ts";

export interface AiRuntimeStatus {
  /** Does something answer on the Ollama base URL right now? */
  running: boolean;
  /** AI OS started this server (or adopted one a crashed run left behind)
   *  and will stop it on quit. false = someone else's, never killed. */
  ownedByUs: boolean;
  /** ownedByUs, but inherited from a previous crashed AI OS run. */
  adopted: boolean;
  version?: string;
  baseUrl: string;
  defaultModel: string;
  /** Where `defaultModel` came from: the environment, Setup's saved choice,
   *  the built-in default, or the only allowed model that is installed. */
  modelSource: "env" | "saved" | "default" | "only-installed";
  /** One plain sentence when the model is not the one asked for. */
  modelNote?: string;
  /** null when the server can't be asked. */
  modelInstalled: boolean | null;
  /** Is the default model resident in memory right now? */
  modelLoaded: boolean;
  loadedModels: string[];
  /** The models in memory with the memory they hold and when each expires.
   *  Read from GET /api/ps, which never loads anything. */
  loaded: LoadedModel[];
  queue: { waiting: number; active: boolean };
  /** Calls the runtime is working on right now (task kind + label only). */
  activeCalls: ActiveCall[];
  /** A "Load now" / warm-up is running in the background. */
  loadInFlight: boolean;
  /** May AI OS start Ollama on its own if it is down? */
  canAutoStart: boolean;
  /** keep_alive sent with every call right now (owned vs reused already applied). */
  keepAlive: string;
  /** Is the load-at-launch switch (AI_OS_AI_PREWARM) on? Off by default. */
  prewarm: boolean;
}

/** GET /api/ai/runtime/log */
export interface AiRuntimeLogResponse {
  /** Random per Next-server run. If it differs from the one a client holds,
   *  the client drops what it has and takes `events` as the whole log. */
  session: string;
  /** When this session (the Next server) started, ms since the epoch. */
  sessionStartedAt: number;
  /** Server clock, ms since the epoch (for the unload countdown). */
  now: number;
  /** The client's `since` did not belong to this session; `events` is everything. */
  reset: boolean;
  latestSeq: number;
  events: AiLogEvent[];
  status: AiRuntimeStatus;
  /** Present only when asked for (`serverLog=1`). */
  serverLog?: ServerLogTail;
}
