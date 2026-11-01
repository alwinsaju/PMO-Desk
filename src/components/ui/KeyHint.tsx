import { cn } from "@/lib/cn";

/** A keyboard key cap for hints ("Ctrl", "Space", "Esc"); pass one per key. */
export function KeyHint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "bg-chip text-ink-muted border-line rounded-control inline-flex h-[20px] min-w-[20px] items-center justify-center border px-1.5 font-sans text-[11px] leading-none font-semibold",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
