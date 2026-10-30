"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { getDisplayBridge } from "@/lib/displayFx";
import { getDesktopBridge } from "@/lib/pmo/desktopBridge";
import type { BackupManifest } from "@/lib/platform/backup";
import {
  checkBackup,
  fetchInfo,
  formatBytes,
  restoreBackupFile,
  saveDownload,
  type PlatformInfo,
} from "./platformApi";
import { Note, Row, Section, when } from "./SettingsParts";

type Pending = { file: File; manifest: BackupManifest; files: number };
type Message = {
  tone: "info" | "error" | "success";
  text: string;
  detail?: string;
} | null;

/** Settings > Data: where the data lives, back up, restore and export it for audits. */
export function DataTab() {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [restored, setRestored] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const bridge = getDesktopBridge();

  const refresh = useCallback(async () => {
    const reply = await fetchInfo();
    if (reply.ok) setInfo(reply);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const download = async (key: string, path: string, name: string, done: string) => {
    setBusy(key);
    setMessage(null);
    const reply = await saveDownload(path, name);
    setBusy(null);
    setMessage(
      reply.ok
        ? { tone: "success", text: `${done} (${reply.name}).` }
        : { tone: "error", text: reply.reason, detail: reply.detail },
    );
  };

  const onPick = async (file: File | undefined) => {
    if (picker.current) picker.current.value = "";
    if (!file) return;
    setBusy("check");
    setMessage(null);
    const reply = await checkBackup(file);
    setBusy(null);
    if (!reply.ok)
      setMessage({ tone: "error", text: reply.reason, detail: reply.detail });
    else setPending({ file, manifest: reply.manifest, files: reply.files });
  };

  const restore = async () => {
    if (!pending) return;
    setBusy("restore");
    const reply = await restoreBackupFile(pending.file);
    setBusy(null);
    setPending(null);
    if (!reply.ok) {
      setMessage({ tone: "error", text: reply.reason, detail: reply.detail });
      return;
    }
    setRestored(true);
    setMessage({
      tone: "success",
      text: `Restored ${reply.restored} files. The data that was replaced is saved in the backups folder.`,
    });
    void refresh();
  };

  const restart = async () => {
    const display = getDisplayBridge();
    if (display) await display.relaunch();
    else window.location.reload();
  };

  return (
    <>
      <Section title="Where your data lives">
        <Row
          title="Data folder"
          hint={
            info
              ? `${info.dataDir} · ${info.files} files · ${formatBytes(info.bytes)}`
              : "Reading the folder…"
          }
        >
          {bridge?.platform && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void bridge.platform?.openDataFolder()}
            >
              Open folder
            </Button>
          )}
        </Row>
        <p className="text-ink-muted pt-2 text-[12.5px]">
          To-dos, the queue, staff, templates and saved settings are kept here, on this
          computer only. Task inputs and outputs live with the Tasks engine and are not
          part of a backup.
        </p>
      </Section>

      <Section title="Back up and restore">
        <Row
          title="Back up now"
          hint="One zip with everything above. Keep a copy somewhere safe."
        >
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void download("backup", "backup", "AI-OS-backup.zip", "Backup created")
            }
          >
            {busy === "backup" ? "Backing up…" : "Back up"}
          </Button>
        </Row>
        <Row
          title="Restore from a backup"
          hint="Replaces your current data with a backup's. The current data is saved first."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => picker.current?.click()}
          >
            Choose a backup…
          </Button>
          <input
            ref={picker}
            type="file"
            accept=".zip,application/zip"
            aria-label="Backup file"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
        </Row>
        {pending && (
          <div
            role="alertdialog"
            aria-label="Confirm restore"
            className="border-line bg-chip rounded-control mt-2 border p-4"
          >
            <p className="text-ink text-[13.5px] font-semibold">
              Restore {pending.files} files from this backup?
            </p>
            <p className="text-ink-muted mt-1 text-[12.5px]">
              Made {when(pending.manifest.createdAt)} with AI OS{" "}
              {pending.manifest.appVersion}. Anything you changed since then is replaced
              (a safety copy is kept).
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => void restore()}>
                {busy === "restore" ? "Restoring…" : "Restore"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {restored && (
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" onClick={() => void restart()}>
              Restart AI OS
            </Button>
            <span className="text-ink-muted text-[12.5px]">
              Restart so every window shows the restored data.
            </span>
          </div>
        )}
      </Section>

      <Section title="Export for audits">
        <Row
          title="JSON"
          hint="To-dos, people, time off and templates in one file. Private fields are left out."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void download("json", "export?kind=json", "AI-OS-data.json", "Exported")
            }
          >
            Export JSON
          </Button>
        </Row>
        <Row
          title="Excel (CSV)"
          hint="One CSV file per list, in a zip. Excel opens them."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void download("csv", "export?kind=csv", "AI-OS-data.zip", "Exported")
            }
          >
            Export CSV
          </Button>
        </Row>
      </Section>
      {message && (
        <Note tone={message.tone} detail={message.detail}>
          {message.text}
        </Note>
      )}
    </>
  );
}
