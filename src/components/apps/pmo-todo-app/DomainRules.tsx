"use client";

import { Button } from "@/components/ui";
import { malformedConfigEntries } from "@/lib/pmo/configHealth";
import type { PmoConfig } from "@/lib/pmo/types";
import { Chip, Note } from "./parts";

type DomainConfig = Pick<PmoConfig, "allowedSenderDomains" | "blockedDomains" | "me">;

function DomainChips({
  label,
  values,
  bad,
  emptyText,
}: {
  label: string;
  values: string[];
  bad: Set<string>;
  emptyText: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
        {label}
      </span>
      {values.length === 0 && (
        <span className="text-ink-muted text-[12.5px]">{emptyText}</span>
      )}
      {values.map((value, index) => (
        <Chip
          key={`${value}-${index}`}
          tone={bad.has(value) ? "warning" : "neutral"}
          title={
            bad.has(value) ? "Not a valid domain: it can never match mail" : undefined
          }
          className="font-mono"
        >
          {bad.has(value) ? `! ${value}` : value}
        </Chip>
      ))}
    </div>
  );
}

/** What the sender-domain rule is made of, so a filtered message can be
 *  explained: the allowed and blocked lists, malformed entries flagged, and the
 *  reminder that filtered mail is gone and has to be sent again. */
export function DomainRules({
  config,
  onOpenSettings,
}: {
  config: DomainConfig;
  onOpenSettings: () => void;
}) {
  const flagged = malformedConfigEntries(config).filter((e) => e.field !== "emails");
  const bad = new Set(flagged.map((entry) => entry.value));
  return (
    <section
      aria-label="Current sender-domain rules"
      className="border-line bg-card rounded-card flex flex-col gap-2.5 border px-4 py-3"
    >
      <DomainChips
        label="Allowed"
        values={config.allowedSenderDomains}
        bad={bad}
        emptyText="None: mail from every domain is filtered."
      />
      <DomainChips
        label="Blocked"
        values={config.blockedDomains}
        bad={bad}
        emptyText="None."
      />
      {flagged.length > 0 && (
        <Note tone="warning" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1">
            {flagged.length === 1
              ? "1 entry is not a valid domain"
              : `${flagged.length} entries are not valid domains`}{" "}
            and can never match mail:{" "}
            {flagged.map((entry) => `${entry.value} (${entry.reason})`).join("; ")}.
          </span>
          <Button size="sm" variant="secondary" onClick={onOpenSettings}>
            Fix in settings
          </Button>
        </Note>
      )}
      <p className="text-ink-muted text-[12.5px] leading-relaxed">
        Filtered mail is discarded, not kept. After you fix the rule, send the message
        again (flag it again, or run the Outlook export with -IgnoreSeen).
      </p>
    </section>
  );
}
