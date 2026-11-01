"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PackageIcon, PlusIcon } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
} from "@/components/ui";
import { toast } from "@/lib/notifications/toastStore";
import { Field, TextArea } from "../pmo-todo-app/parts";
import { MailerWizardDialog } from "./MailerWizardDialog";
import { PackErrorLine, type PackErrorState } from "./PackErrorLine";
import {
  fetchPacks,
  inspectPack,
  installPack,
  removePack,
  type InspectedPack,
  type PackSummary,
} from "./packsApi";

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function InstallDialog({
  file,
  pack,
  replacing,
  onClose,
  onInstalled,
}: {
  file: File;
  pack: InspectedPack;
  replacing: boolean;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PackErrorState | null>(null);
  const matches = typed.trim().toLowerCase() === pack.fingerprint;

  const install = async () => {
    setBusy(true);
    setError(null);
    const reply = await installPack(file, pack.fingerprint);
    setBusy(false);
    if (!reply.ok) {
      setError({ reason: reply.reason, detail: reply.detail });
      return;
    }
    toast({ tone: "success", message: `Installed “${pack.name}”.` });
    onInstalled();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[620px]">
        <DialogTitle>
          {replacing ? "Update" : "Install"} “{pack.name}”?
        </DialogTitle>
        <DialogDescription>
          Version {pack.packVersion || "?"} · {pack.files.length} files ·{" "}
          {kb(pack.totalBytes)}
        </DialogDescription>
        <div className="mt-3 flex flex-col gap-3">
          <p
            role="note"
            className="bg-amber-soft text-ink rounded-control px-3 py-2 text-[13px]"
          >
            A task pack contains scripts that run on this computer with your access.
            Install it only if you trust who made it. A task still stops at the review
            step, but a script is code.
          </p>
          <Field label="Fingerprint (SHA-256)">
            <code
              data-testid="pack-fingerprint"
              className="bg-chip rounded-control block px-3 py-2 text-[12px] break-all select-all"
            >
              {pack.fingerprint}
            </code>
          </Field>
          <Field label="Type the fingerprint the publisher gave you to confirm it matches">
            <TextArea
              rows={2}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Confirm fingerprint"
              placeholder="Paste the fingerprint here"
            />
          </Field>
          <details>
            <summary className="text-ink-soft cursor-pointer text-[13px] font-semibold">
              Files and steps
            </summary>
            <ul className="text-ink-soft mt-2 max-h-40 overflow-auto text-[12.5px]">
              {pack.files.map((f) => (
                <li key={f.path}>
                  {f.path} <span className="text-ink-muted">({kb(f.size)})</span>
                  {f.runs && <span className="text-amber"> · runs code</span>}
                </li>
              ))}
            </ul>
            <p className="text-ink-muted mt-2 text-[12.5px]">
              Steps: {pack.steps.map((s) => `${s.id} (${s.type})`).join(" → ")}
            </p>
          </details>
          {error && <PackErrorLine error={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!matches || busy} onClick={() => void install()}>
              {busy ? "Installing…" : replacing ? "Update" : "Install"}
            </Button>
          </div>
          {!matches && typed.trim() !== "" && (
            <p className="text-ink-muted text-[12px]">
              That does not match this pack&apos;s fingerprint.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tasks > Packs: add a task from a checksummed pack, build a mailer with a wizard, remove a pack. */
export function PacksTab({ onChanged }: { onChanged: () => void }) {
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [error, setError] = useState<PackErrorState | null>(null);
  const [chosen, setChosen] = useState<{
    file: File;
    pack: InspectedPack;
    installed: boolean;
  } | null>(null);
  const [wizard, setWizard] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const reply = await fetchPacks();
    if (reply.ok) {
      setPacks(reply.packs);
      setError(null);
    } else setError({ reason: reply.reason, detail: reply.detail });
  }, []);
  useEffect(() => {
    void (async () => {
      const reply = await fetchPacks();
      if (reply.ok) setPacks(reply.packs);
      else setError({ reason: reply.reason, detail: reply.detail });
    })();
  }, []);

  const pick = async (file: File | undefined) => {
    if (picker.current) picker.current.value = "";
    if (!file) return;
    const reply = await inspectPack(file);
    if (!reply.ok) setError({ reason: reply.reason, detail: reply.detail });
    else {
      setError(null);
      setChosen({ file, pack: reply.pack, installed: reply.installed });
    }
  };

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const remove = async (pack: PackSummary) => {
    setConfirmId(null);
    const reply = await removePack(pack.id);
    if (!reply.ok) setError({ reason: reply.reason, detail: reply.detail });
    else {
      toast({ tone: "success", message: `Removed “${pack.name}”.` });
      await load();
      onChanged();
    }
  };

  const changed = async () => {
    setChosen(null);
    setWizard(false);
    await load();
    onChanged();
  };

  return (
    <div className="flex w-full flex-col gap-4 px-6 pt-2 pb-6" data-testid="packs-tab">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-ink-muted min-w-48 flex-1 text-[13px]">
          Add a task without reinstalling PMO Desk. A pack is checked against its
          checksums before anything is installed.
        </p>
        <Button size="sm" onClick={() => setWizard(true)}>
          New mailer…
        </Button>
        <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
          Install a pack…
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".zip,application/zip"
          aria-label="Task pack file"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error && <PackErrorLine error={error} />}
      {packs && packs.length === 0 && (
        <EmptyState
          icon={<PackageIcon size={22} />}
          headline="No packs installed"
          description="Build a mailer with “New mailer…”, or install a pack someone gave you."
        />
      )}
      {packs && packs.length > 0 && (
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4"
          aria-label="Installed packs"
        >
          {packs.map((pack) => (
            <li
              key={pack.id}
              data-testid="pack-card"
              className="border-line bg-card rounded-card flex min-w-0 flex-col gap-3 border p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="bg-accent-soft text-accent-ink flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
                >
                  <PackageIcon size={20} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="text-ink block truncate text-[14px] font-semibold"
                    title={pack.name}
                  >
                    {pack.name}
                  </span>
                  <span className="text-ink-muted block truncate text-[12px]">
                    {pack.fingerprint.slice(0, 16)}…
                  </span>
                </span>
                <Badge variant="neutral">v{pack.packVersion || "?"}</Badge>
              </div>
              {confirmId === pack.id ? (
                <div className="mt-auto flex flex-col gap-2">
                  <p className="text-ink-muted text-[12px]">
                    Also deletes its inputs and outputs.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void remove(pack)}>
                      Yes, remove
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmId(null)}
                    >
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => setConfirmId(pack.id)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
          <li className="contents">
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="border-line-strong text-ink-soft hover:bg-chip focus-visible:ring-focus rounded-card flex min-h-[112px] flex-col items-center justify-center gap-1.5 border border-dashed p-4 text-[13px] font-semibold outline-none focus-visible:ring-2"
            >
              <PlusIcon size={18} weight="bold" aria-hidden />
              Install a pack…
            </button>
          </li>
        </ul>
      )}
      {chosen && (
        <InstallDialog
          file={chosen.file}
          pack={chosen.pack}
          replacing={chosen.installed}
          onClose={() => setChosen(null)}
          onInstalled={() => void changed()}
        />
      )}
      {wizard && (
        <MailerWizardDialog
          onClose={() => setWizard(false)}
          onCreated={() => void changed()}
        />
      )}
    </div>
  );
}
