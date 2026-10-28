// Reminder delivery: which of the reminders computeDue (../due.ts) produces
// have not been shown yet, and who gets to show them.
//
// A client (the Electron shell, or a browser tab) CLAIMS the not-yet-delivered
// reminders; the server records the claim in state/notify.json under the lock,
// so two clients that ask at the same moment get disjoint sets. After showing
// them the client ACKNOWLEDGES the claim and the keys become "delivered" for
// good. A claim that is never acknowledged (the client crashed, the machine
// slept) expires after CLAIM_TTL_MS and its reminders become claimable again,
// so a crash cannot lose a reminder, at worst it repeats one.
//
// Nothing here sends anything: it only decides, and records, what the local
// client may display.
import {
  attentionSummary,
  computeDue,
  toastFor,
  type Attention,
  type DueNotification,
  type Toast,
} from "../due.ts";
import { istDate } from "../time.ts";
import { newId } from "../todoLogic.ts";
import type { ReminderPrefs } from "../types.ts";
import type { Pmo } from "./actions.ts";
import type { NotifyState } from "./store.ts";

/** An unacknowledged claim blocks others for this long. */
export const CLAIM_TTL_MS = 3 * 60_000;
/** Bookkeeping retention: delivered keys and stale claims are dropped after this. */
const DELIVERED_KEEP_MS = 45 * 24 * 3_600_000;
const CLAIM_KEEP_MS = 24 * 3_600_000;

export interface DuePreview {
  now: string;
  today: string;
  /** What a claim made now would return. */
  pending: DueNotification[];
  attention: Attention;
  prefs: ReminderPrefs;
}

export interface ClaimResult {
  /** null when there was nothing new to show. */
  claimId: string | null;
  notifications: DueNotification[];
  /** One ready-to-show notification for the whole batch (privacy default applied). */
  toast: Toast | null;
  attention: Attention;
  prefs: ReminderPrefs;
}

/** Under the Electron shell (AI_OS_DESKTOP_MODE=1) only the shell may claim:
 *  it sends `x-ai-os-desktop: 1` (the same marker the runtime-stop route asks
 *  for; a custom header forces a CORS preflight, which is what keeps a web
 *  page from setting it). A browser tab pointed at the same server would
 *  otherwise race the shell and could swallow a reminder into a tab nobody is
 *  looking at. Outside the shell (pnpm dev / next start) tabs may claim. */
export function remindersOwnedByDesktop(
  headers: Pick<Headers, "get">,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AI_OS_DESKTOP_MODE === "1" && headers.get("x-ai-os-desktop") !== "1";
}

const cleanClient = (value: unknown): string =>
  typeof value === "string" && /^[\w:.-]{1,60}$/.test(value) ? value : "unknown";

function pruned(state: NotifyState, nowMs: number): NotifyState {
  const delivered = Object.fromEntries(
    Object.entries(state.delivered).filter(
      ([, entry]) => nowMs - Date.parse(entry.at) < DELIVERED_KEEP_MS,
    ),
  );
  const claims = Object.fromEntries(
    Object.entries(state.claims).filter(
      ([, claim]) => nowMs - Date.parse(claim.at) < CLAIM_KEEP_MS,
    ),
  );
  return { delivered, claims };
}

/** Keys that nobody may claim right now: delivered, or claimed and still fresh. */
function blockedKeys(state: NotifyState, nowMs: number): Set<string> {
  const blocked = new Set(Object.keys(state.delivered));
  for (const claim of Object.values(state.claims)) {
    if (nowMs - Date.parse(claim.at) < CLAIM_TTL_MS) {
      for (const { key } of claim.keys) blocked.add(key);
    }
  }
  return blocked;
}

/** Read-only: what is waiting, and the attention counts for the badge. */
export async function previewDue(pmo: Pmo): Promise<DuePreview> {
  const now = pmo.now();
  const [config, todos, state] = await Promise.all([
    pmo.store.loadConfig(),
    pmo.store.listTodos(),
    pmo.store.loadNotify(),
  ]);
  const blocked = blockedKeys(state, now.getTime());
  return {
    now: now.toISOString(),
    today: istDate(now, config.reminders.timeZone),
    pending: computeDue(todos, now, config.reminders).filter((n) => !blocked.has(n.key)),
    attention: attentionSummary(todos, now, config.reminders),
    prefs: config.reminders,
  };
}

/** Atomically claim every reminder not yet delivered or claimed. */
export function claimDue(pmo: Pmo, body: unknown): Promise<ClaimResult> {
  const client = cleanClient((body as { client?: unknown } | undefined)?.client);
  return pmo.store.withLock(async () => {
    const now = pmo.now();
    const nowMs = now.getTime();
    const [config, todos, loaded] = await Promise.all([
      pmo.store.loadConfig(),
      pmo.store.listTodos(),
      pmo.store.loadNotify(),
    ]);
    const state = pruned(loaded, nowMs);
    const blocked = blockedKeys(state, nowMs);
    const fresh = computeDue(todos, now, config.reminders).filter(
      (n) => !blocked.has(n.key),
    );

    let claimId: string | null = null;
    if (fresh.length > 0) {
      claimId = newId("cl");
      state.claims[claimId] = {
        at: now.toISOString(),
        client,
        keys: fresh.map((n) => ({ key: n.key, kind: n.kind, todoId: n.todoId })),
      };
    }
    if (
      claimId ||
      Object.keys(loaded.delivered).length !== Object.keys(state.delivered).length
    ) {
      await pmo.store.saveNotify(state);
    }
    return {
      claimId,
      notifications: fresh,
      toast: toastFor(fresh, config.reminders),
      attention: attentionSummary(todos, now, config.reminders),
      prefs: config.reminders,
    };
  });
}

/** The client has shown the claim: its reminders are delivered for good.
 *  Idempotent; an unknown or already-acknowledged claim changes nothing. */
export function acknowledgeDue(
  pmo: Pmo,
  body: unknown,
): Promise<{ acknowledged: number }> {
  const claimId = (body as { claimId?: unknown } | undefined)?.claimId;
  if (typeof claimId !== "string") return Promise.resolve({ acknowledged: 0 });
  return pmo.store.withLock(async () => {
    const state = await pmo.store.loadNotify();
    const claim = state.claims[claimId];
    if (!claim) return { acknowledged: 0 };
    const at = pmo.now().toISOString();
    for (const { key, kind, todoId } of claim.keys) {
      state.delivered[key] = { at, kind, todoId, client: claim.client };
    }
    delete state.claims[claimId];
    await pmo.store.saveNotify(state);
    return { acknowledged: claim.keys.length };
  });
}
