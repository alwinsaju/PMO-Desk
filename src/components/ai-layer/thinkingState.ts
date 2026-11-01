// The command bar's "Thinking..." clock and Stop state for a free-form model
// request. Pure, so the elapsed/stop rules are unit-tested.

export interface ThinkingState {
  /** When the request started; null when no model request is running. */
  startedAt: number | null;
  elapsedSeconds: number;
  /** The last request ended because the person pressed Stop. */
  stopped: boolean;
}

export type ThinkingAction =
  | { type: "start"; at: number }
  | { type: "tick"; now: number }
  | { type: "stop" }
  | { type: "finish" };

export const IDLE_THINKING: ThinkingState = {
  startedAt: null,
  elapsedSeconds: 0,
  stopped: false,
};

/** Seconds of waiting before the "local models can take a minute" hint shows. */
export const SLOW_HINT_AFTER_SECONDS = 4;

export const STOPPED_NOTICE = "Stopped.";

export const isThinking = (state: ThinkingState): boolean => state.startedAt !== null;

export function thinkingReducer(
  state: ThinkingState,
  action: ThinkingAction,
): ThinkingState {
  switch (action.type) {
    case "start":
      return { startedAt: action.at, elapsedSeconds: 0, stopped: false };
    case "tick": {
      if (state.startedAt === null) return state;
      const elapsed = Math.max(0, Math.floor((action.now - state.startedAt) / 1000));
      return elapsed === state.elapsedSeconds
        ? state
        : { ...state, elapsedSeconds: elapsed };
    }
    case "stop":
      return state.startedAt === null
        ? state
        : { startedAt: null, elapsedSeconds: 0, stopped: true };
    case "finish":
      return IDLE_THINKING;
  }
}

export function thinkingHint(elapsedSeconds: number): string | null {
  return elapsedSeconds >= SLOW_HINT_AFTER_SECONDS
    ? "Local models can take a minute. Press Esc or Stop to cancel."
    : null;
}
