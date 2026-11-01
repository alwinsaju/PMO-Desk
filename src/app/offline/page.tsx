"use client";

import { WifiSlashIcon } from "@phosphor-icons/react";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { Button } from "@/components/ui";

/**
 * The page the service worker serves when PMO Desk is opened without a
 * connection. Same look as the rest of the redesign: the desktop wallpaper
 * behind a frosted card, so it follows dark mode and Deloitte mode through the
 * tokens. A Client Component only for the "Try again" button's reload.
 */
export default function OfflinePage() {
  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <Wallpaper />
      <section className="glass-pop rounded-surface animate-rise relative w-full max-w-md px-8 py-10 text-center">
        <span
          aria-hidden
          className="bg-accent-soft text-accent-ink rounded-control mx-auto grid h-14 w-14 place-items-center"
        >
          <WifiSlashIcon size={28} weight="duotone" />
        </span>
        <p className="text-ink-muted mt-5 text-[11.5px] font-bold tracking-[0.16em] uppercase">
          PMO Desk
        </p>
        <h1 className="font-headline text-ink mt-2 text-3xl leading-tight tracking-[-0.03em]">
          You&apos;re <span className="accent-word">offline</span>
        </h1>
        <p className="text-ink-soft mx-auto mt-3 max-w-sm text-sm leading-6">
          Reconnect to continue working in PMO Desk. Your installed app will be available
          again as soon as the connection is restored.
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </section>
    </main>
  );
}
