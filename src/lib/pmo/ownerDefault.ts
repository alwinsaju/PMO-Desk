// Who "me" is on a proposal. The model only knows a person by what the mail
// says, and a small model (or the test stub) fills `owner` with whatever name it
// likes while marking it "mine". The names and addresses given at setup
// (`config.me`) are the truth, so a draft that is mine carries those, never the
// name of the Windows account (that one is only the audit actor, see
// server/actions.ts). Pure and client-safe.
import type { Owner, PmoConfig } from "./types.ts";

const key = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Is `value` one of the names or addresses given at setup? */
export function isConfiguredIdentity(
  value: string | null | undefined,
  me: PmoConfig["me"],
): boolean {
  if (!value) return false;
  const wanted = key(value);
  return wanted !== "" && [...me.names, ...me.emails].some((own) => key(own) === wanted);
}

/** `value` matches the user, or is the word "me" the model uses for the user. */
export function isMe(value: string | null | undefined, me: PmoConfig["me"]): boolean {
  return !!value && (key(value) === "me" || isConfiguredIdentity(value, me));
}

const firstOf = (list: readonly string[]) => list.map((s) => s.trim()).find(Boolean);
const isRealName = (value: string | null) => !!value && key(value) !== "me";

/**
 * A draft that is mine (the model says so, or the owner is one of my names or
 * addresses) is owned by the first configured name and address, unless it already
 * carries one of mine. A draft that is somebody else's is returned as it is, and
 * nothing is invented when nothing is configured.
 * `replaced` is true when a different, non-empty name or address was overwritten
 * (worth telling the reviewer); filling in a blank is silent.
 */
export function defaultOwnerToMe(
  owner: Owner,
  me: PmoConfig["me"],
): { owner: Owner; replaced: boolean } {
  const mine =
    owner.isMe === true ||
    isConfiguredIdentity(owner.name, me) ||
    isConfiguredIdentity(owner.email, me);
  if (!mine) return { owner, replaced: false };

  const pick = (current: string | null, configured: readonly string[]): string | null => {
    if (isConfiguredIdentity(current, me)) return current;
    return firstOf(configured) ?? current;
  };
  const name = pick(owner.name, me.names);
  const email = pick(owner.email, me.emails);
  const replaced =
    (isRealName(owner.name) && owner.name !== name) ||
    (isRealName(owner.email) && owner.email !== email);
  return { owner: { name, email, isMe: true }, replaced };
}
