"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import {
  FIRST_RUN_STEPS,
  firstRunPayload,
  initialFirstRunForm,
  modernTimeZone,
  nameToGoBy,
  stepProblems,
  suggestedDomain,
  timeZoneChoices,
  withSuggestedDomain,
  type FirstRunForm,
} from "@/lib/pmo/firstRun";
import { checkEmail, parseDomainList } from "@/lib/pmo/listValidation";
import type { FirstRunSuggestions } from "@/lib/pmo/server/firstRun";
import {
  clearProgress,
  loadProgress,
  saveProfile,
  saveProgress,
  skippedStepForm,
  withRememberedProfile,
  type WizardStorage,
} from "@/lib/pmo/firstRunMemory";
import { createInboxFolder, fetchFirstRunSuggestions, finishFirstRun } from "./api";
import { DOMAIN_NOUN } from "./listFeedbackView";
import { ListFeedback, SuggestionRow } from "./ListFeedback";
import { ErrorLine, Field, FieldError, NativeSelect, Note, ScrollBody } from "./parts";
import {
  StepIllustration,
  WizardDone,
  WizardStepper,
  WizardSummary,
} from "./WizardParts";
import { STEP_INTRO, nextBlockedReason, wizardSummary } from "@/lib/pmo/wizardView";

const detectedTimeZone = () => {
  try {
    return modernTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  } catch {
    return "";
  }
};

const supportedTimeZones = () =>
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

const baseForm = () =>
  initialFirstRunForm({ suggestedName: "", detectedTimeZone: detectedTimeZone() });

const browserStorage = (): WizardStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

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
  onSaved,
  onDone,
}: {
  windowId: string;
  /** The answers were saved (the window refetches; the wizard stays for "You're set"). */
  onSaved: () => void;
  /** The person left the "You're set" screen. */
  onDone: () => void;
}) {
  const [resumed] = useState(() =>
    loadProgress(browserStorage(), baseForm(), Date.now()),
  );
  const [form, setForm] = useState<FirstRunForm>(
    () => resumed?.form ?? withRememberedProfile(browserStorage(), baseForm()),
  );
  const [step, setStep] = useState(resumed?.step ?? 0);
  const [problems, setProblems] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FirstRunSuggestions | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // A folder that already holds other JSON: asked once, then confirmed.
  const [confirmFolder, setConfirmFolder] = useState<
    { action: "create"; parent: string } | { action: "finish" } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Keep the place, so closing the window does not start the wizard over. Not
  // once it is finished: that would bring the saved progress back.
  useEffect(() => {
    if (!done) saveProgress(browserStorage(), { step, form }, Date.now());
  }, [step, form, done]);
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

  // Live checks: Next stays disabled while an entry the server would refuse is in the box.
  const allowedParsed = useMemo(
    () => parseDomainList(form.allowedDomains),
    [form.allowedDomains],
  );
  const blockedParsed = useMemo(
    () => parseDomainList(form.blockedDomains),
    [form.blockedDomains],
  );
  const emailChecked = form.email.trim() === "" ? null : checkEmail(form.email);
  const emailProblem = emailChecked && !emailChecked.ok ? emailChecked.reason : null;
  const domainSuggestion = suggestedDomain(form);
  const entriesInvalid = nextBlockedReason(current.id, {
    emailProblem,
    invalidDomains: allowedParsed.invalid.length + blockedParsed.invalid.length,
    allowedDomains: allowedParsed.valid.length,
  });

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
    setStep(step + 1);
  }

  function skip() {
    const skipped = skippedStepForm(current.id, form, detectedTimeZone());
    if (!skipped) return;
    const found = stepProblems(current.id, skipped);
    if (found.length > 0) return setProblems(found);
    setProblems([]);
    setServerError(null);
    setForm(
      FIRST_RUN_STEPS[step + 1]?.id === "domains"
        ? withSuggestedDomain(skipped)
        : skipped,
    );
    setStep(step + 1);
  }

  async function finish(confirmNonEmpty = false) {
    const result = firstRunPayload(form);
    if (!result.ok) return setProblems(result.problems);
    setBusy(true);
    setServerError(null);
    try {
      const reply = await finishFirstRun({ ...result.payload, confirmNonEmpty });
      if (reply.ok) {
        // Done: forget the unfinished place, but remember who you are for the next data folder.
        saveProfile(browserStorage(), form);
        clearProgress(browserStorage());
        setDone(true);
        return onSaved();
      }
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
      {/* m-auto centres the content in the window and still scrolls when it is taller. */}
      <ScrollBody className="flex px-6 py-8">
        <div className="m-auto flex w-full max-w-lg flex-col gap-6">
          {done ? (
            <WizardDone form={form} onContinue={onDone} />
          ) : (
            <>
              <header className="flex flex-col gap-4">
                <WizardStepper step={step} />
                <div className="flex items-center gap-4">
                  <StepIllustration step={current.id} />
                  <div className="flex min-w-0 flex-col gap-2">
                    <h2 className="text-ink text-[26px] leading-tight font-semibold">
                      {current.title}
                    </h2>
                    <p className="text-ink-muted text-[14px] leading-relaxed">
                      {STEP_INTRO[current.id]}
                    </p>
                    {resumed && step === resumed.step && (
                      <p className="text-ink-muted text-[13px] leading-relaxed">
                        Welcome back: your earlier answers are filled in.
                      </p>
                    )}
                  </div>
                </div>
              </header>

              {current.id === "who" && (
                <div className="flex flex-col gap-3.5">
                  <Field label="Your Deloitte email address">
                    <Input
                      type="email"
                      value={form.email}
                      autoComplete="email"
                      placeholder="first.last@deloitte.com"
                      aria-invalid={emailProblem ? true : undefined}
                      onChange={(event) => set({ email: event.target.value })}
                    />
                    <FieldError message={emailProblem ?? undefined} />
                  </Field>
                  <Field label="Your full name (optional)">
                    <Input
                      value={form.fullName}
                      autoComplete="name"
                      placeholder={
                        emailChecked?.ok
                          ? nameToGoBy(form.email.trim())
                          : suggestions?.nameHint || "Filled in from Microsoft 365"
                      }
                      onChange={(event) => set({ fullName: event.target.value })}
                    />
                    <span className="text-ink-muted text-[12px]">
                      Leave it empty: your full name and photo come from Microsoft 365 and
                      show on the lock screen.
                    </span>
                  </Field>
                  <Field label="Short names and other spellings (optional, comma separated)">
                    <Input
                      value={form.otherNames}
                      placeholder="Pat, P. Example"
                      onChange={(event) => set({ otherNames: event.target.value })}
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
                      <option value={form.timeZone}>
                        {form.timeZone || "Choose..."}
                      </option>
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
                  <div className="flex flex-col gap-2">
                    <Field label="Sender domains you receive work mail from (comma separated)">
                      <Input
                        value={form.allowedDomains}
                        spellCheck={false}
                        placeholder={domainSuggestion ?? "company.com"}
                        aria-invalid={allowedParsed.invalid.length > 0 ? true : undefined}
                        onFocus={(event) => {
                          if (
                            domainSuggestion &&
                            form.allowedDomains === domainSuggestion
                          ) {
                            event.currentTarget.select();
                          }
                        }}
                        onChange={(event) => set({ allowedDomains: event.target.value })}
                      />
                      <span className="text-ink-muted text-[12px]">
                        Mail from any other domain is filtered and discarded. Subdomains
                        match.
                      </span>
                    </Field>
                    {domainSuggestion && form.allowedDomains.trim() === "" && (
                      <SuggestionRow
                        suggestion={domainSuggestion}
                        onUse={() => set({ allowedDomains: domainSuggestion })}
                      />
                    )}
                    <ListFeedback parsed={allowedParsed} noun={DOMAIN_NOUN} />
                    {form.allowedDomains.trim() === "" && (
                      <span className="text-ink-muted text-[12px]">
                        Enter at least one domain, for example company.com.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Field label="Domains to always block (optional)">
                      <Input
                        value={form.blockedDomains}
                        spellCheck={false}
                        placeholder="other-company.example"
                        aria-invalid={blockedParsed.invalid.length > 0 ? true : undefined}
                        onChange={(event) => set({ blockedDomains: event.target.value })}
                      />
                    </Field>
                    <ListFeedback parsed={blockedParsed} noun={DOMAIN_NOUN} />
                  </div>
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
                          OneDrive is not signed in on this computer. Choose a folder
                          below.
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

              {last && (
                <WizardSummary
                  rows={wizardSummary(form)}
                  disabled={busy}
                  onChange={(id) => {
                    setProblems([]);
                    setServerError(null);
                    setStep(FIRST_RUN_STEPS.findIndex((s) => s.id === id));
                  }}
                />
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
                  <span className="flex items-center gap-2">
                    {skippedStepForm(current.id, form, detectedTimeZone()) && (
                      <Button variant="ghost" onClick={skip}>
                        Skip for now
                      </Button>
                    )}
                    <Button
                      onClick={next}
                      disabled={entriesInvalid !== null}
                      aria-describedby={entriesInvalid ? "wizard-next-reason" : undefined}
                    >
                      Next
                    </Button>
                  </span>
                )}
              </div>
              {entriesInvalid && !last && (
                <p
                  id="wizard-next-reason"
                  role="status"
                  className="text-ink-muted -mt-1 text-right text-[12px]"
                >
                  {entriesInvalid}
                </p>
              )}
            </>
          )}
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
