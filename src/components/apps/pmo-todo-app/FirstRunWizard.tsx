"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import {
  FIRST_RUN_STEPS,
  firstRunPayload,
  initialFirstRunForm,
  stepProblems,
  timeZoneChoices,
  withSuggestedDomain,
  type FirstRunForm,
} from "@/lib/pmo/firstRun";
import type { FirstRunSuggestions } from "@/lib/pmo/server/firstRun";
import { createInboxFolder, fetchFirstRunSuggestions, finishFirstRun } from "./api";
import { ErrorLine, Field, NativeSelect, Note, ScrollBody, SectionLabel } from "./parts";

const detectedTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

const supportedTimeZones = () =>
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/** A folder the person may use as the inbox: `parent` is where PMO-Inbox would be created. */
interface FolderChoice {
  path: string;
  parent: string;
  exists: boolean;
}

/**
 * The PMO's first run: four short steps (who you are, time zone, sender
 * domains, inbox folder). Until it is finished the PMO ingests nothing, and the
 * inbox folder is created only by the "Create PMO-Inbox here" button. The
 * answers are checked here (firstRun.ts) and again on the server.
 */
export function FirstRunWizard({
  windowId,
  onDone,
}: {
  windowId: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FirstRunForm>(() =>
    initialFirstRunForm({ suggestedName: "", detectedTimeZone: detectedTimeZone() }),
  );
  const [step, setStep] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FirstRunSuggestions | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // A folder that already holds other JSON: asked once, then confirmed.
  const [confirmFolder, setConfirmFolder] = useState<
    { action: "create"; parent: string } | { action: "finish" } | null
  >(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFirstRunSuggestions()
      .then((reply) => {
        if (cancelled || !reply.ok) return;
        setSuggestions(reply);
        setForm((current) => ({
          ...current,
          fullName: current.fullName || reply.fullName,
          inboxDir: current.inboxDir || reply.inbox.fromEnvironment || "",
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const zones = useMemo(
    () => timeZoneChoices(supportedTimeZones(), detectedTimeZone()),
    [],
  );
  const bridge = getDesktopBridge();
  const fixedInbox = suggestions?.inbox.fromEnvironment ?? null;
  const current = FIRST_RUN_STEPS[step];
  const last = step === FIRST_RUN_STEPS.length - 1;

  const set = (patch: Partial<FirstRunForm>) => {
    setForm((value) => ({ ...value, ...patch }));
    setProblems([]);
    setServerError(null);
    setConfirmFolder(null);
  };

  function next() {
    const found = stepProblems(current.id, form);
    if (found.length > 0) return setProblems(found);
    setProblems([]);
    setServerError(null);
    if (FIRST_RUN_STEPS[step + 1]?.id === "domains") setForm(withSuggestedDomain(form));
    setStep(step + 1);
  }

  async function finish(confirmNonEmpty = false) {
    const result = firstRunPayload(form);
    if (!result.ok) return setProblems(result.problems);
    setBusy(true);
    setServerError(null);
    try {
      const reply = await finishFirstRun({ ...result.payload, confirmNonEmpty });
      if (reply.ok) return onDone();
      setServerError(reply.reason);
      setConfirmFolder(reply.needsConfirmation ? { action: "finish" } : null);
    } catch {
      setServerError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  async function createFolder(parent: string, confirmNonEmpty = false) {
    setBusy(true);
    setServerError(null);
    try {
      const reply = await createInboxFolder(parent, confirmNonEmpty);
      if (reply.ok) {
        setConfirmFolder(null);
        setForm((value) => ({ ...value, inboxDir: reply.path }));
        const refreshed = await fetchFirstRunSuggestions();
        if (refreshed.ok) setSuggestions(refreshed);
        return;
      }
      setServerError(reply.reason);
      setConfirmFolder(reply.needsConfirmation ? { action: "create", parent } : null);
    } catch {
      setServerError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  async function choose() {
    const folder = await bridge?.chooseFolder?.();
    if (folder) {
      setPicked(folder);
      set({ inboxDir: folder });
    }
  }

  const choices: FolderChoice[] = suggestions?.inbox.suggestions ?? [];

  return (
    <div data-window-id={windowId} className="flex h-full w-full flex-col">
      <ScrollBody className="px-6 py-6">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          <header className="flex flex-col gap-1.5">
            <SectionLabel>
              Set up PMO To-Do - step {step + 1} of {FIRST_RUN_STEPS.length}
            </SectionLabel>
            <h2 className="text-ink text-xl font-semibold">{current.title}</h2>
            <p className="text-ink-muted text-[13px] leading-relaxed">
              Nothing is read from your mail until you finish this. Everything stays on
              this computer.
            </p>
          </header>

          {current.id === "who" && (
            <div className="flex flex-col gap-3.5">
              <Field label="Your full name">
                <Input
                  value={form.fullName}
                  autoComplete="name"
                  placeholder="Pat Example"
                  onChange={(event) => set({ fullName: event.target.value })}
                />
              </Field>
              <Field label="Short names and other spellings (optional, comma separated)">
                <Input
                  value={form.otherNames}
                  placeholder="Pat, P. Example"
                  onChange={(event) => set({ otherNames: event.target.value })}
                />
              </Field>
              <Field label="Your work email address">
                <Input
                  type="email"
                  value={form.email}
                  autoComplete="email"
                  placeholder="you@company.com"
                  onChange={(event) => set({ email: event.target.value })}
                />
              </Field>
            </div>
          )}

          {current.id === "timeZone" && (
            <Field label="Time zone">
              <NativeSelect
                value={form.timeZone}
                onChange={(event) => set({ timeZone: event.target.value })}
              >
                {!zones.includes(form.timeZone) && (
                  <option value={form.timeZone}>{form.timeZone || "Choose..."}</option>
                )}
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-ink-muted text-[12px]">
                Used for due dates and reminders. We preselected the one this computer
                uses.
              </span>
            </Field>
          )}

          {current.id === "domains" && (
            <div className="flex flex-col gap-3.5">
              <Field label="Sender domains you receive work mail from (comma separated)">
                <Input
                  value={form.allowedDomains}
                  spellCheck={false}
                  placeholder="company.com"
                  onChange={(event) => set({ allowedDomains: event.target.value })}
                />
                <span className="text-ink-muted text-[12px]">
                  Mail from any other domain is filtered. Subdomains match.
                </span>
              </Field>
              <Field label="Domains to always block (optional)">
                <Input
                  value={form.blockedDomains}
                  spellCheck={false}
                  placeholder="other-company.example"
                  onChange={(event) => set({ blockedDomains: event.target.value })}
                />
              </Field>
            </div>
          )}

          {current.id === "inbox" && (
            <div className="flex flex-col gap-3.5">
              {fixedInbox ? (
                <Note tone="neutral">
                  The inbox folder is fixed by this computer&apos;s settings:{" "}
                  <span className="font-mono">{fixedInbox}</span>
                </Note>
              ) : (
                <>
                  <p className="text-ink-muted text-[13px] leading-relaxed">
                    The folder your Outlook flow drops messages into. It is only read, and
                    a new folder is created only when you click the button.
                  </p>
                  {choices.map((choice) => (
                    <FolderRow
                      key={choice.path}
                      choice={choice}
                      selected={form.inboxDir === choice.path}
                      busy={busy}
                      onUse={() => set({ inboxDir: choice.path })}
                      onCreate={() => void createFolder(choice.parent)}
                    />
                  ))}
                  {suggestions && !suggestions.inbox.oneDriveSignedIn && (
                    <Note tone="neutral">
                      OneDrive is not signed in on this computer. Choose a folder below.
                    </Note>
                  )}
                  {picked && (
                    <FolderRow
                      choice={{ path: picked, parent: picked, exists: true }}
                      selected={form.inboxDir === picked}
                      busy={busy}
                      createLabel="Create PMO-Inbox here"
                      onUse={() => set({ inboxDir: picked })}
                      onCreate={() => void createFolder(picked)}
                    />
                  )}
                  <div className="flex items-end gap-2">
                    <Field label="Inbox folder (full path)" className="flex-1">
                      <Input
                        value={form.inboxDir}
                        spellCheck={false}
                        placeholder="C:\Users\you\OneDrive\PMO-Inbox"
                        onChange={(event) => set({ inboxDir: event.target.value })}
                      />
                    </Field>
                    {bridge?.chooseFolder && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void choose()}
                      >
                        Choose folder
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {problems.length > 0 && (
            <div className="flex flex-col gap-1">
              {problems.map((problem) => (
                <ErrorLine key={problem}>{problem}</ErrorLine>
              ))}
            </div>
          )}
          {serverError && <ErrorLine>{serverError}</ErrorLine>}
          {confirmFolder && (
            <Button
              variant="secondary"
              disabled={busy}
              className="self-start"
              onClick={() =>
                confirmFolder.action === "finish"
                  ? void finish(true)
                  : void createFolder(confirmFolder.parent, true)
              }
            >
              Use this folder anyway
            </Button>
          )}

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              disabled={step === 0 || busy}
              onClick={() => {
                setProblems([]);
                setServerError(null);
                setStep(step - 1);
              }}
            >
              Back
            </Button>
            {last ? (
              <Button disabled={busy} onClick={() => void finish()}>
                {busy ? "Saving..." : "Finish setup"}
              </Button>
            ) : (
              <Button onClick={next}>Next</Button>
            )}
          </div>
        </div>
      </ScrollBody>
    </div>
  );
}

function FolderRow({
  choice,
  selected,
  busy,
  createLabel = "Create PMO-Inbox here",
  onUse,
  onCreate,
}: {
  choice: FolderChoice;
  selected: boolean;
  busy: boolean;
  createLabel?: string;
  onUse: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="border-line bg-card rounded-card flex items-center justify-between gap-3 border px-3.5 py-2.5">
      <span
        className="text-ink min-w-0 flex-1 truncate font-mono text-[12px]"
        title={choice.path}
      >
        {choice.path}
        {choice.exists ? "" : "  (not created yet)"}
      </span>
      {choice.exists && (
        <Button
          size="sm"
          variant={selected ? "solid" : "outline"}
          disabled={busy}
          onClick={onUse}
        >
          {selected ? "Selected" : "Use this folder"}
        </Button>
      )}
      {(!choice.exists || choice.path === choice.parent) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onCreate}>
          {createLabel}
        </Button>
      )}
    </div>
  );
}
