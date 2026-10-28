// The original developer's identity, kept ONLY as a test fixture so tests that
// need a realistic, fully configured PMO can say so explicitly. Production
// code must never import this: its defaults are neutral (see PmoConfigSchema).
import { PmoConfigSchema, type PmoConfig } from "./types.ts";

export const DEVELOPER_INBOX_DIR =
  "C:\\Users\\alsaju\\OneDrive - Deloitte (O365D)\\PMO-Inbox";

/** A configured, set-up config; `inboxDir` is usually a temp folder in tests. */
export function developerConfig(overrides: Partial<PmoConfig> = {}): PmoConfig {
  return PmoConfigSchema.parse({
    inboxDir: DEVELOPER_INBOX_DIR,
    setupComplete: true,
    allowedSenderDomains: ["deloitte.com"],
    blockedDomains: ["takeda.com"],
    me: { names: ["Alwin Saju", "Saju", "Alwin"], emails: ["alsaju@deloitte.com"] },
    ...overrides,
  });
}
