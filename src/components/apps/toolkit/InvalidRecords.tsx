"use client";

import { useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { invalidLines, recordFromInvalid } from "@/lib/registers/invalidRecords";
import type { InvalidRecord, RegisterDef, RegisterRecord } from "@/lib/registers/types";
import type { RegisterState } from "./useRegister";

/** Saved records that fail today's checks (for example a value that is no longer one of the options). They
 *  are not shown in the list, and they are never deleted by a save: each can be fixed in the form, or
 *  removed here once you have looked at it. */
export function InvalidRecords({
  def,
  state,
  onRepair,
}: {
  def: RegisterDef;
  state: RegisterState;
  onRepair: (record: RegisterRecord) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.invalid.length === 0) return null;

  const remove = async (entry: InvalidRecord) => {
    setBusy(true);
    const reply = await state.remove([entry.key]);
    setBusy(false);
    setConfirming(null);
    if (!reply.ok) toast({ tone: "danger", message: reply.reason });
    else toast({ tone: "success", message: `Removed “${entry.title}” from the file.` });
  };

  const count = state.invalid.length;
  return (
    <details
      open
      className="bg-amber-soft rounded-card mx-6 mb-2 px-3 py-2"
      data-testid="invalid-records"
    >
      <summary className="text-ink flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
        <WarningIcon size={16} weight="fill" aria-hidden className="text-amber" />
        {count === 1
          ? "1 saved record cannot be shown"
          : `${count} saved records cannot be shown`}
      </summary>
      <p className="text-ink-soft mt-2 text-[12.5px]">
        {count === 1 ? "It does" : "They do"} not pass this tool’s checks, so{" "}
        {count === 1 ? "it is" : "they are"} left out of the list and the counts. Nothing
        has been deleted: {count === 1 ? "it stays" : "they stay"} in the file until you
        fix or remove {count === 1 ? "it" : "them"}.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {state.invalid.map((entry) => {
          const record = recordFromInvalid(def, entry);
          return (
            <li
              key={entry.key}
              className="border-line bg-card rounded-md border px-3 py-2 text-[12.5px]"
              data-testid="invalid-record"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink min-w-0 flex-1 font-semibold break-words">
                  {entry.title}
                </span>
                {record && (
                  <Button size="sm" variant="outline" onClick={() => onRepair(record)}>
                    Fix
                  </Button>
                )}
                {confirming === entry.key ? (
                  <>
                    <span className="text-red">Remove it for good?</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red"
                      disabled={busy}
                      onClick={() => void remove(entry)}
                    >
                      Yes, remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red"
                    onClick={() => setConfirming(entry.key)}
                  >
                    Remove…
                  </Button>
                )}
              </div>
              <p className="text-ink-soft mt-1 break-words">{entry.reason}</p>
              <details className="mt-1">
                <summary className="text-ink-muted cursor-pointer">What it says</summary>
                <ul className="text-ink-soft mt-1 list-disc pl-5 break-words">
                  {invalidLines(def, entry).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
