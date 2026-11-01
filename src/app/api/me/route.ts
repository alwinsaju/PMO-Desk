import { handle } from "@/lib/pmo/server/http";
import type { PmoService } from "@/lib/pmo/server/service";
import { registerSelf } from "@/lib/staff/self";

export const dynamic = "force-dynamic";

/** Adds the M365 full name to the names that mean "me" in mail (it never replaces one). */
async function learnFullName(pmo: PmoService, name: string): Promise<void> {
  await pmo.store.withLock(async () => {
    const config = await pmo.store.loadConfig();
    const known = config.me.names.some((n) => n.toLowerCase() === name.toLowerCase());
    if (known || config.me.names.length >= 50) return;
    await pmo.store.saveConfig({
      ...config,
      me: { ...config.me, names: [...config.me.names, name] },
    });
    await pmo.store.audit("config", { changed: ["me.names"] });
  });
}

/**
 * GET /api/me -> { ok, self } where self is { email, name, photoUrl?, pending } or null.
 * You, as the roster knows you: the work email from the PMO setup is put on the roster
 * (as its first member) if it is not there yet and the M365 profile flow is asked for the
 * rest. The lock screen greets with this.
 */
export function GET(request: Request) {
  return handle(request, async (pmo) => {
    const config = await pmo.store.loadConfig();
    const email = config.me.emails[0];
    const self = email ? await registerSelf({ email, name: config.me.names[0] }) : null;
    if (self && !self.pending && self.name) {
      await learnFullName(pmo, self.name).catch(() => undefined);
    }
    return { ok: true, self };
  });
}
