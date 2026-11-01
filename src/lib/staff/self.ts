// You, as the roster knows you: what the lock screen greets. The person who sets PMO Desk up
// gives their work email once; they join the roster as its first member and the M365 profile
// flow brings their full name and photo, exactly as for anyone else. Server only.
import { syncExchange } from "./exchangeServer.ts";
import { fullName, isAwaitingProfile, photoUrl } from "./employees.ts";
import { ensureSelf, readStaff } from "./server.ts";

type Env = Record<string, string | undefined>;

export interface SelfProfile {
  email: string;
  /** The full name on the roster ("" only when nothing usable is known). */
  name: string;
  /** The profile picture, once the M365 profile has brought one. */
  photoUrl?: string;
  /** Still waiting for the M365 profile: the page should look again shortly. */
  pending: boolean;
}

/** Adds you to the roster when needed and asks the profile flow for your profile.
 *  Never throws: the lock screen must not depend on the roster or on OneDrive. */
export async function registerSelf(
  input: { email: string; name?: string },
  env: Env = process.env,
): Promise<SelfProfile | null> {
  try {
    const added = await ensureSelf(input, env);
    if (!added) return null;
    // Applies a profile that has arrived and writes the request for one that has not.
    if (isAwaitingProfile(added)) await syncExchange(env).catch(() => undefined);
    const me = (await readStaff("employees", env)).find((e) => e.id === added.id);
    if (!me) return null;
    return {
      email: me.deloitteEmail,
      name: fullName(me),
      photoUrl: photoUrl(me),
      pending: isAwaitingProfile(me),
    };
  } catch (error) {
    console.error("[staff] could not look up your profile:", error);
    return null;
  }
}
