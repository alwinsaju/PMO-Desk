// Thread awareness: which open to-do (if any) does a new message belong to?
// The rule is deterministic and deliberately conservative: two messages are in
// one thread only when they carry the SAME key, and a key is only ever built
// from fields the producer gave us. Pure (no node imports), so the server, the
// UI and `pnpm test` share it.
//
//   outlook  outlook|<mailbox>|<conversationId>        needs thread.conversationId
//   teams    teams|conv|<tenant>|<conversationId>      when the producer gave one (the flow's
//                                                      Conversation ID, e.g. 19:...@unq.gbl.spaces)
//            teams|chat|<tenant>|<chatId>              a 1:1 or group chat (chat id from
//                                                      context or the deep link)
//            teams|chat|<tenant>|<channelId>|<root>    a channel post/reply (id ends @thread.tacv2,
//                                                      from either field): root is the link's
//                                                      parentMessageId, else thread.parentId,
//                                                      else its own message id
//   manual   never (a paste has no reliable thread)
//
// Keys include the source, the tenant (Teams) and the mailbox (Outlook), so
// nothing matches across sources, tenants or mailboxes. An intake without a
// usable id has no key and never matches.
import { teamsIdsOf } from "./filter.ts";
import type { Intake, Todo } from "./types.ts";

const norm = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

function teamsLink(link: string | undefined): {
  messageId?: string;
  parentMessageId?: string;
} {
  if (!link) return {};
  try {
    const url = new URL(link);
    const parts = /^\/l\/message\/([^/]+)\/([^/?#]+)/.exec(url.pathname);
    const parent = url.searchParams.get("parentMessageId") ?? undefined;
    return {
      messageId: parts?.[2] ? decodeURIComponent(parts[2]) : undefined,
      parentMessageId: parent || undefined,
    };
  } catch {
    return {};
  }
}

/** The conversation key of an intake, or null when it has none. */
export function threadKeyOf(
  intake: Pick<Intake, "source" | "thread" | "context" | "link" | "sourceId">,
): string | null {
  const conversationId = norm(
    (intake.thread as { conversationId?: string }).conversationId,
  );
  if (intake.source === "outlook") {
    return conversationId
      ? `outlook|${norm(intake.context.mailbox)}|${conversationId}`
      : null;
  }
  if (intake.source === "teams") {
    const { tenantId, chatId } = teamsIdsOf(intake);
    const tenant = norm(tenantId);
    // An explicit conversation id from the producer (the Power Automate flow
    // sends the trigger's "Conversation ID" here and in context.chatId) wins
    // over anything read from the deep link. Both are the same kind of id
    // (19:...@thread.v2, 19:...@unq.gbl.spaces, 19:...@thread.tacv2).
    const id = conversationId || norm(chatId);
    if (!id) return null;
    // A channel (…@thread.tacv2) holds many unrelated posts: only a post and
    // its own replies share a key, whichever field carried the id. A 1:1 or
    // group chat is one key; the model is then asked whether the new message
    // is about the same thing at all.
    if (/@thread\.tacv2$/.test(id)) {
      const link = teamsLink(intake.link);
      const parentId = (intake.thread as { parentId?: string }).parentId;
      const root = norm(link.parentMessageId || parentId || link.messageId);
      return root ? `teams|chat|${tenant}|${id}|${root}` : null;
    }
    return conversationId
      ? `teams|conv|${tenant}|${conversationId}`
      : `teams|chat|${tenant}|${id}`;
  }
  return null;
}

/** The open to-do a message with `key` belongs to: equal keys only; with more
 *  than one candidate the most recently updated wins (then the lowest id, so
 *  the choice never depends on file order). */
export function pickMatchingTodo<T extends Pick<Todo, "id" | "status" | "updatedAt">>(
  key: string | null,
  candidates: readonly { todo: T; key: string | null }[],
): T | null {
  if (!key) return null;
  const hits = candidates.filter((c) => c.key === key && c.todo.status === "open");
  if (hits.length === 0) return null;
  hits.sort(
    (a, b) =>
      b.todo.updatedAt.localeCompare(a.todo.updatedAt) ||
      a.todo.id.localeCompare(b.todo.id),
  );
  return hits[0].todo;
}

// ---------------------------------------------------------------------------
// "Looks like a reply from the person we are waiting on"
// ---------------------------------------------------------------------------

const STOP = new Set([
  "the",
  "and",
  "of",
  "from",
  "with",
  "for",
  "team",
  "dept",
  "department",
  "group",
  "mr",
  "mrs",
  "ms",
  "dr",
]);

const tokens = (text: string | null | undefined): string[] =>
  (text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP.has(token));

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Does the sender look like the person or team the to-do waits on? Matches an
 *  address named in `waitingOn`, or enough name tokens in common: "Priya Nair"
 *  matches "Priya Nair (Finance)" and "Priya", not "Priya Menon". A hint for a
 *  human to confirm, never a decision. */
export function looksLikeReplyFrom(
  waitingOn: string | null | undefined,
  sender: { name?: string | null; address?: string | null },
): boolean {
  const waiting = (waitingOn ?? "").trim();
  if (!waiting) return false;
  const address = norm(sender.address);
  if (address) {
    const named = (waiting.match(EMAIL) ?? []).map((email) => email.toLowerCase());
    if (named.includes(address)) return true;
  }
  const wanted = new Set(tokens(waiting.replace(EMAIL, " ")));
  if (wanted.size === 0) return false;
  const local = address.split("@")[0] ?? "";
  const have = new Set([...tokens(sender.name), ...tokens(local)]);
  if (have.size === 0) return false;
  let shared = 0;
  for (const token of wanted) if (have.has(token)) shared++;
  return shared >= 1 && shared >= Math.min(wanted.size, have.size, 2);
}

/** A mail address from `people` that matches `waitingOn`, when exactly one
 *  does (used to pre-fill the To line of a chaser mail window). */
export function addressForWaitingOn(
  waitingOn: string | null | undefined,
  people: readonly { name?: string | null; address?: string | null }[],
  mine: readonly string[] = [],
): string | null {
  const own = new Set(mine.map(norm));
  const hits = new Set<string>();
  for (const person of people) {
    const address = norm(person.address);
    if (!address || own.has(address)) continue;
    if (looksLikeReplyFrom(waitingOn, person)) hits.add(address);
  }
  return hits.size === 1 ? [...hits][0] : null;
}
