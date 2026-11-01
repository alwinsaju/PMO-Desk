"use client";

import { useEffect, useState } from "react";
import { PmoDeskMark } from "@/components/brand/PmoDeskMark";
import { Button, Switch } from "@/components/ui";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import { usePlatformPrefs } from "@/lib/platform/platformPrefsStore";
import { RELEASES } from "@/lib/platform/releaseNotes";
import {
  downloadUpdate,
  fetchInfo,
  saveDownload,
  type PlatformInfo,
} from "./platformApi";
import { Note, Row, Section, when } from "./SettingsParts";
import { runUpdateCheck, type UpdateOutcome } from "./updateActions";

type Message = {
  tone: "info" | "error" | "success";
  text: string;
  detail?: string;
} | null;

function Updates() {
  const updates = usePlatformPrefs((s) => s.updates);
  const [url, setUrl] = useState(updates.manifestUrl);
  const [busy, setBusy] = useState<"check" | "download" | null>(null);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const bridge = getDesktopBridge();

  const setUpdates = (patch: Partial<typeof updates>) =>
    usePlatformPrefs
      .getState()
      .update((p) => ({ ...p, updates: { ...p.updates, ...patch } }));

  const saveUrl = () => {
    if (url.trim() !== updates.manifestUrl) {
      setUpdates({ manifestUrl: url.trim(), availableVersion: "" });
    }
  };

  const check = async () => {
    saveUrl();
    setBusy("check");
    setMessage(null);
    setDownloaded(null);
    setOutcome(await runUpdateCheck());
    setBusy(null);
  };

  const download = async () => {
    setBusy("download");
    setMessage(null);
    const reply = await downloadUpdate(usePlatformPrefs.getState().updates.manifestUrl);
    setBusy(null);
    if (!reply.ok)
      setMessage({ tone: "error", text: reply.reason, detail: reply.detail });
    else {
      setDownloaded(reply.name);
      setMessage({
        tone: "success",
        text: `Downloaded ${reply.name} to your Downloads folder and checked its checksum.`,
      });
    }
  };

  return (
    <Section title="Updates">
      <Row
        settingId="updates"
        title="Check for updates"
        hint="Off by default. When on, PMO Desk reads one small file from the address below about once a day. It never installs anything by itself."
      >
        <Switch
          checked={updates.enabled}
          onCheckedChange={(on) => setUpdates({ enabled: on })}
          aria-label="Check for updates"
        />
      </Row>
      <div className="py-3">
        <label className="text-ink text-[13px] font-semibold" htmlFor="update-url">
          Update address
        </label>
        <input
          id="update-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={saveUrl}
          placeholder="https://… (latest.json)"
          className="border-line bg-chip text-ink rounded-control mt-1 w-full border px-3 py-2 text-[13.5px] outline-none"
        />
        <p className="text-ink-muted mt-1 text-[12.5px]">
          Your IT team or the PMO Desk publisher gives you this address. It must be https.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || url.trim() === ""}
            onClick={() => void check()}
          >
            {busy === "check" ? "Checking…" : "Check now"}
          </Button>
          {updates.lastCheckedAt && (
            <span className="text-ink-muted text-[12.5px]">
              Last checked {when(updates.lastCheckedAt)}
            </span>
          )}
        </div>
      </div>
      {outcome && !outcome.ok && (
        <Note tone="error" detail={outcome.detail}>
          {outcome.reason}
        </Note>
      )}
      {outcome?.ok && !outcome.available && (
        <Note tone="success">PMO Desk is up to date.</Note>
      )}
      {outcome?.ok && outcome.available && (
        <div className="border-line bg-chip rounded-control mt-1 border p-4">
          <p className="text-ink text-[13.5px] font-semibold">
            Version {outcome.version} is available
          </p>
          {outcome.notes.length > 0 && (
            <ul className="text-ink-soft mt-1 list-disc pl-5 text-[13px]">
              {outcome.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void download()}>
              {busy === "download" ? "Downloading…" : "Download installer"}
            </Button>
            {downloaded && bridge?.platform && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void bridge.platform?.openInstaller(downloaded)}
              >
                Start installer
              </Button>
            )}
          </div>
        </div>
      )}
      {message && (
        <Note tone={message.tone} detail={message.detail}>
          {message.text}
        </Note>
      )}
    </Section>
  );
}

function Support() {
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    setMessage(null);
    const reply = await saveDownload("diagnostics", "AI-OS-diagnostics.zip");
    setBusy(false);
    setMessage(
      reply.ok
        ? { tone: "success", text: `Saved ${reply.name}. Send it to support.` }
        : { tone: "error", text: reply.reason, detail: reply.detail },
    );
  };
  return (
    <Section title="Support">
      <Row
        settingId="diagnostics"
        title="Diagnostics file"
        hint="Versions, counts and the end of the logs, with passwords, tokens, email addresses and user names removed. No to-do or message text is included."
      >
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void make()}>
          {busy ? "Creating…" : "Create diagnostics file"}
        </Button>
      </Row>
      {message && (
        <Note tone={message.tone} detail={message.detail}>
          {message.text}
        </Note>
      )}
    </Section>
  );
}

/** Settings > About: the version, what's new, the opt-in update check and the diagnostics file. */
export function AboutTab() {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  useEffect(() => {
    void (async () => {
      const reply = await fetchInfo();
      if (reply.ok) setInfo(reply);
    })();
  }, []);

  return (
    <>
      <div className="mb-4 flex items-center gap-4 px-1" data-testid="about-brand">
        <PmoDeskMark size={56} />
        <div className="min-w-0">
          <p className="font-headline text-ink text-xl leading-tight">PMO Desk</p>
          <p className="text-ink-muted text-[13px]">
            Your PMO workspace, with a local AI beside you.
          </p>
        </div>
        <span
          aria-hidden
          className="brand-dl:block ml-auto hidden h-6 w-32 shrink-0 bg-[url('/brand/deloitte-light.png')] bg-contain bg-right bg-no-repeat dark:bg-[url('/brand/deloitte-dark.png')]"
        />
      </div>
      <Section title="PMO Desk">
        <Row
          settingId="version"
          title="Version"
          hint={info?.desktop ? "Desktop app" : "Running in a browser"}
        >
          <span className="text-ink text-[14px] font-semibold" data-testid="app-version">
            {info?.version ?? "…"}
          </span>
        </Row>
      </Section>
      <Section title="What's new">
        {RELEASES.map((release) => (
          <div key={release.version} className="mb-3" data-testid="release-notes">
            <p className="text-ink text-[14px] font-semibold">
              {release.title} <span className="text-ink-muted">({release.version})</span>
            </p>
            {release.groups.map((group) => (
              <div key={group.title} className="mt-2">
                <p className="text-ink-muted text-[12px] font-bold tracking-[0.06em] uppercase">
                  {group.title}
                </p>
                <ul className="text-ink-soft mt-1 list-disc pl-5 text-[13px]">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </Section>
      <Updates />
      <Support />
    </>
  );
}
