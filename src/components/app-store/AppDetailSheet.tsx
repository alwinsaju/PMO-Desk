"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui";
import { appCategories, appIcons } from "./appCatalog";
import { detailsFor, sizeLabel } from "./appDetails";
import { AppIconTile } from "./AppIconTile";
import { InstallButton } from "./InstallButton";
import { isDemoApp } from "./installFlow";
import type { AppListing } from "./types";

/** An app's detail sheet: what it is, what it does, its size, and the same Install / Open button as its card. */
export function AppDetailSheet({
  app,
  isInstalled,
  onPrimaryAction,
  onClose,
}: {
  app: AppListing | null;
  isInstalled: boolean;
  onPrimaryAction: (app: AppListing) => void;
  onClose: () => void;
}) {
  if (!app) return null;
  const details = detailsFor(app);
  const demo = isDemoApp(app);
  const rows = [
    ["Developer", app.developer],
    ["Category", appCategories.find((c) => c.id === app.category)?.label ?? app.category],
    ["Size", sizeLabel(app, details)],
    ["Kind", demo ? "Sample app" : "Web app"],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[520px] overflow-y-auto">
        <div className="flex items-center gap-4 pr-6">
          <AppIconTile icon={appIcons[app.icon]} seed={app.id} brandSlot={0} />
          <div className="min-w-0">
            <DialogTitle>{app.name}</DialogTitle>
            <DialogDescription className="mt-0.5">{app.tagline}</DialogDescription>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <InstallButton
            app={app}
            isInstalled={isInstalled}
            onPrimaryAction={() => onPrimaryAction(app)}
            className="min-w-[110px]"
          />
          {demo && (
            <span className="text-ink-muted text-[12.5px]">
              Sample app: installing it only adds it to the dock.
            </span>
          )}
        </div>

        <section className="mt-5">
          <h3 className="text-ink-muted mb-1 text-[11.5px] font-bold tracking-[0.06em] uppercase">
            About
          </h3>
          <p className="text-ink-soft text-[14px] leading-relaxed">
            {details.description}
          </p>
        </section>

        {details.does.length > 0 && (
          <section className="mt-4">
            <h3 className="text-ink-muted mb-1 text-[11.5px] font-bold tracking-[0.06em] uppercase">
              {demo ? "What it would do" : "What it does"}
            </h3>
            <ul className="text-ink-soft list-disc space-y-0.5 pl-5 text-[14px]">
              {details.does.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        <dl className="border-line mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t pt-4 text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
