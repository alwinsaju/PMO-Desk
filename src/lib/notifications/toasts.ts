// The rules of the toast queue and the notification history, kept pure so they can be
// tested. toastStore.ts holds the live state; ToastHost.tsx draws it.

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  /** 0 keeps the toast until it is dismissed. */
  durationMs?: number;
  action?: ToastAction;
  /** A toast with the same key replaces the earlier one instead of stacking. */
  key?: string;
}

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
  action?: ToastAction;
  key?: string;
}

/** Everything that was ever shown, newest last (the notification centre reads this). */
export interface NotificationEntry {
  id: number;
  message: string;
  tone: ToastTone;
  at: number;
}

export interface ToastState {
  nextId: number;
  toasts: Toast[];
  history: NotificationEntry[];
}

export const DEFAULT_TOAST_MS = 5_000;
/** Errors and anything with an action stay a little longer so they can be read or used. */
export const LONG_TOAST_MS = 9_000;
export const MAX_VISIBLE_TOASTS = 4;
export const MAX_HISTORY = 100;
export const MAX_MESSAGE_LENGTH = 400;

export const EMPTY_TOAST_STATE: ToastState = { nextId: 1, toasts: [], history: [] };

function clip(message: string): string {
  const text = message.trim().replace(/\s+/g, " ");
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
    : text;
}

export function resolveDuration(input: ToastInput): number {
  if (typeof input.durationMs === "number" && input.durationMs >= 0)
    return input.durationMs;
  return input.tone === "danger" || input.action ? LONG_TOAST_MS : DEFAULT_TOAST_MS;
}

/** Show a toast. An empty message is ignored; a repeated key replaces its earlier toast.
 *  `quiet` (focus mode) keeps it in the history only, except errors. */
export function pushToast(
  state: ToastState,
  input: ToastInput,
  now: number,
  quiet = false,
): ToastState {
  const message = clip(input.message);
  if (!message) return state;
  const tone = input.tone ?? "info";
  const toast: Toast = {
    id: state.nextId,
    message,
    tone,
    durationMs: resolveDuration(input),
    ...(input.action ? { action: input.action } : {}),
    ...(input.key ? { key: input.key } : {}),
  };
  const history = [...state.history, { id: toast.id, message, tone, at: now }].slice(
    -MAX_HISTORY,
  );
  if (quiet && tone !== "danger") return { ...state, nextId: state.nextId + 1, history };
  const kept = input.key ? state.toasts.filter((t) => t.key !== input.key) : state.toasts;
  const toasts = [...kept, toast].slice(-MAX_VISIBLE_TOASTS);
  return { nextId: state.nextId + 1, toasts, history };
}

export function dismissToast(state: ToastState, id: number): ToastState {
  return state.toasts.some((t) => t.id === id)
    ? { ...state, toasts: state.toasts.filter((t) => t.id !== id) }
    : state;
}

export function clearHistory(state: ToastState): ToastState {
  return state.history.length ? { ...state, history: [] } : state;
}
