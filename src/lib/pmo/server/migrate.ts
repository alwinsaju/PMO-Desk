// Tolerant reads: bring a record written by an older version into the current
// shape before it is validated, so an old file is accepted (and rewritten in
// the new shape the next time it is saved) instead of being quarantined. Unknown
// extra fields are simply dropped by the schemas. Pure.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

export function migrateProposal(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const createdAt = text(value.createdAt) ?? text(value.updatedAt);
  return {
    draft: null,
    edits: null,
    isActionable: null,
    confidence: null,
    quoteVerified: null,
    ...value,
    ai: {
      model: null,
      durationMs: null,
      attempts: 0,
      ...(isRecord(value.ai) ? value.ai : {}),
    },
    createdAt,
    updatedAt: text(value.updatedAt) ?? createdAt,
  };
}

export function migrateTodo(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const createdAt =
    text(value.createdAt) ?? text(value.approvedAt) ?? text(value.updatedAt);
  const nobody = { name: null, email: null };
  return {
    description: "",
    status: "open",
    dueAt: null,
    priority: "normal",
    actionItems: [],
    checkpoints: [],
    tags: [],
    waitingOn: null,
    approvedBy: "unknown",
    ...value,
    owner: { ...nobody, isMe: null, ...(isRecord(value.owner) ? value.owner : {}) },
    requester: { ...nobody, ...(isRecord(value.requester) ? value.requester : {}) },
    reminders: {
      enabled: false,
      remindAt: null,
      snoozedUntil: null,
      lastRemindedAt: null,
      ...(isRecord(value.reminders) ? value.reminders : {}),
    },
    createdAt,
    approvedAt: text(value.approvedAt) ?? createdAt,
    updatedAt: text(value.updatedAt) ?? createdAt,
  };
}
