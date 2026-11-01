const SPARK = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z";

/**
 * The "AI is working" chip in the title bar of a window the AI is driving (the
 * `.chip.ai` of the approved mock-up): a pill with the spark icon. Window.tsx shows it only
 * while `controlledBy === "ai"`, so it is gone the moment control goes back to the person.
 */
export function AiWorkingChip() {
  return (
    <span
      role="status"
      data-testid="ai-working-chip"
      className="bg-accent-soft text-accent-ink rounded-pill ml-auto inline-flex shrink-0 items-center gap-1.5 px-2.5 py-[3px] text-xs leading-tight font-semibold whitespace-nowrap"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={SPARK} />
      </svg>
      AI is working
    </span>
  );
}
