import Link from "next/link";
import { CompassIcon } from "@phosphor-icons/react/ssr";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { Button } from "@/components/ui";

/**
 * The themed 404. Next's built-in not-found page is an unstyled white
 * screen; this one sits on the same wallpaper as the desktop (so it follows
 * dark mode and Deloitte mode through the tokens like everything else) with a
 * frosted card, a big light headline and a way back. A Server Component:
 * nothing here needs client state (the Phosphor icon comes from the `/ssr`
 * entry for that reason).
 */
export default function NotFound() {
  return (
    <main className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <Wallpaper />
      <section className="glass-pop rounded-surface animate-rise relative w-full max-w-md px-8 py-10 text-center">
        <span
          aria-hidden
          className="bg-accent-soft text-accent-ink rounded-control mx-auto grid h-14 w-14 place-items-center"
        >
          <CompassIcon size={28} weight="duotone" />
        </span>
        <p className="text-ink-muted mt-5 text-[11.5px] font-bold tracking-[0.16em] uppercase">
          Error 404
        </p>
        <h1 className="font-headline text-ink mt-2 text-4xl leading-tight tracking-[-0.03em]">
          This page <span className="accent-word">isn&apos;t here</span>
        </h1>
        <p className="text-ink-soft mx-auto mt-3 max-w-sm text-sm leading-6">
          The address you followed doesn&apos;t lead anywhere in AI OS. It may have moved,
          or never existed.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back to the desktop</Link>
        </Button>
      </section>
    </main>
  );
}
