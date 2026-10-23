export default function OfflinePage() {
  return (
    <main className="flex h-full items-center justify-center bg-[var(--color-surface)] p-6 text-[var(--color-ink)]">
      <section className="max-w-md text-center">
        <p className="text-sm font-medium tracking-[0.16em] text-[var(--color-ink-muted)] uppercase">
          AI OS
        </p>
        <h1 className="mt-3 text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-muted)]">
          Reconnect to continue working in AI OS. Your installed app will be available
          again as soon as the connection is restored.
        </p>
      </section>
    </main>
  );
}
