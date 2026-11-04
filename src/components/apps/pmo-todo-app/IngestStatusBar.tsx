"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowsClockwiseIcon,
  BellRingingIcon,
  BookmarkSimpleIcon,
  ClipboardTextIcon,
  DotsThreeIcon,
  GearIcon,
  InfoIcon,
  RobotIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from "@/components/ui";
import { ModelLogDialog } from "@/components/ai-runtime";
import { cn } from "@/lib/cn";
import type { PmoState } from "@/lib/pmo/types";
import { scanNow } from "./api";
import { GUTTER_X } from "./parts";
import { SavedExamplesDialog } from "./SavedExamplesDialog";
import { relativeTime } from "./queueView";
import { enableReminders, useRemindersStore } from "./remindersStore";
import {
  buildNotices,
  modelStatus,
  offersReminderPrompt,
  scanSummary,
  type ModelTone,
  type Notice,
} from "./toolbarView";

interface PmoToolbarProps {
  state: PmoState;
  /** The tab list, drawn at the start of the bar. */
  tabs: ReactNode;
  onPaste: () => void;
  onSettings: () => void;
  onSettled: () => void;
}

/** The model dot: green with a soft halo when loaded and idle, grey when asleep
 *  (the normal idle state), amber while it wakes up, the accent while it works,
 *  red when the model is not there. */
const DOT: Record<ModelTone, string> = {
  ready:
    "bg-success-dot shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success-dot)_22%,transparent)]",
  idle: "bg-ink-faint",
  waking:
    "bg-amber shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-amber)_20%,transparent)]",
  working:
    "bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
  off: "bg-red shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-red)_18%,transparent)]",
};

/** Re-renders every second while `active`, for the unload countdown in the chip. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** How long the result of "Scan now" stays in place of the model status. */
const SCAN_NOTE_MS = 6000;

/**
 * The single row at the top of the window: the tabs on the left, then a status
 * strip with the model status and the few things you do (Scan now, Paste,
 * Settings); the strip's bottom hairline sweeps while a scan runs. Everything that
 * is only information (inbox path, last scan, filtered count) lives in tooltips
 * and in Settings, and anything that needs attention is a notice underneath
 * (`NoticeStack`). The window is a size container: labels drop to icons below
 * ~670 px and the actions fold into one menu below ~510 px. The model status is
 * a button: it opens the model log (what the model is doing this session).
 */
export function PmoToolbar({
  state,
  tabs,
  onPaste,
  onSettings,
  onSettled,
}: PmoToolbarProps) {
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permission = useRemindersStore((s) => s.permission);
  const desktop = useRemindersStore((s) => s.desktop);
  const { ingest } = state;
  const [logOpen, setLogOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const counting = state.runtime.state === "ready" && Boolean(state.runtime.unloadsAt);
  const status = modelStatus(state, useNow(counting));
  const remindersOffered = offersReminderPrompt(permission, desktop);

  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  const showNote = (text: string) => {
    setScanNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setScanNote(null), SCAN_NOTE_MS);
  };

  async function scan() {
    if (scanning) return;
    setScanning(true);
    try {
      const reply = await scanNow();
      showNote(reply.ok ? `Scan: ${scanSummary(reply.report)}` : reply.reason);
      onSettled();
    } catch {
      showNote("Could not reach the app server.");
    } finally {
      setScanning(false);
    }
  }

  const scanned = ingest.lastScanAt
    ? `Last scan ${relativeTime(ingest.lastScanAt, Date.parse(state.serverTime))}`
    : "Not scanned yet";
  const chipText = scanNote ?? status.chip;

  return (
    <div className={cn("flex shrink-0 items-center gap-3 pt-2 pb-3", GUTTER_X)}>
      <div className="min-w-0 shrink [scrollbar-width:none] overflow-x-auto">{tabs}</div>

      {/* The status strip: model dot, what it is doing, the actions. The hairline
          sweeps along the bottom edge while a scan or the model is working. */}
      <div
        data-scanning={scanning || status.busy}
        className="rounded-card border-line bg-card relative flex h-12 min-w-0 flex-1 items-center gap-3 overflow-hidden border pr-1.5 pl-4"
      >
        <Tooltip
          className="max-w-72"
          label={
            <span className="flex flex-col gap-0.5">
              <span>{status.detail}</span>
              <span className="opacity-75">Click to see what the model is doing</span>
            </span>
          }
        >
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            aria-label={`${status.detail}${scanNote ? `. ${scanNote}` : ""}. Click to see what the model is doing.`}
            aria-haspopup="dialog"
            className="text-ink-soft hover:text-ink rounded-chip focus-visible:ring-focus -ml-1 flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 pl-1 text-left text-[13px] font-semibold outline-none focus-visible:ring-2"
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                DOT[status.tone],
                status.busy && "motion-safe:animate-blink",
              )}
            />
            <span className="hidden min-w-0 truncate @xl:inline">{chipText}</span>
            {/* While the model is waking or working the chip needs the room. */}
            {!status.busy && (
              <span className="text-ink-muted hidden shrink-0 text-[12px] font-medium @6xl:inline">
                {scanned}
              </span>
            )}
          </button>
        </Tooltip>
        {/* Announces changes of state to screen readers (the button's own name is
            the full description). */}
        <span role="status" className="sr-only">
          {chipText}
        </span>

        {/* Wide: the actions as buttons. */}
        <div className="hidden shrink-0 items-center gap-1.5 @lg:flex">
          <Tooltip label={`Scan the inbox now. ${scanned}.`}>
            <Button
              variant="secondary"
              disabled={scanning}
              aria-label="Scan now"
              className="px-2.5 @2xl:px-4"
              onClick={() => void scan()}
            >
              <ArrowsClockwiseIcon
                size={15}
                weight="bold"
                className={scanning ? "motion-safe:animate-rot" : ""}
              />
              <span className="hidden @2xl:inline">
                {scanning ? "Scanning" : "Scan now"}
              </span>
            </Button>
          </Tooltip>
          <Tooltip label="Paste a Teams message or an email">
            <Button
              variant="secondary"
              aria-label="Paste a message"
              className="px-2.5 @2xl:px-4"
              onClick={onPaste}
            >
              <ClipboardTextIcon size={15} weight="bold" />
              <span className="hidden @2xl:inline">Paste</span>
            </Button>
          </Tooltip>
          {remindersOffered && (
            <IconButton
              aria-label="Enable reminders"
              tooltip="Enable reminders in this browser"
              variant="ghost"
              onClick={() => void enableReminders()}
            >
              <BellRingingIcon size={18} />
            </IconButton>
          )}
          <IconButton
            aria-label="Saved examples"
            tooltip="Saved examples for the model"
            variant="ghost"
            onClick={() => setExamplesOpen(true)}
          >
            <BookmarkSimpleIcon size={18} />
          </IconButton>
          <IconButton aria-label="PMO settings" variant="ghost" onClick={onSettings}>
            <GearIcon size={18} />
          </IconButton>
        </div>

        {/* Narrow: the same actions in one menu. */}
        <div className="shrink-0 @lg:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions" variant="ghost">
                <DotsThreeIcon size={20} weight="bold" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="max-w-64 tracking-normal whitespace-normal normal-case">
                {scanNote ?? status.detail}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setLogOpen(true)}>
                <RobotIcon size={14} />
                What the model is doing
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={scanning} onSelect={() => void scan()}>
                <ArrowsClockwiseIcon size={14} weight="bold" />
                Scan now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onPaste}>
                <ClipboardTextIcon size={14} weight="bold" />
                Paste a message
              </DropdownMenuItem>
              {remindersOffered && (
                <DropdownMenuItem onSelect={() => void enableReminders()}>
                  <BellRingingIcon size={14} />
                  Enable reminders
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setExamplesOpen(true)}>
                <BookmarkSimpleIcon size={14} />
                Saved examples
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSettings}>
                <GearIcon size={14} />
                PMO settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <i aria-hidden className="scan-bar" />
      </div>
      <ModelLogDialog open={logOpen} onOpenChange={setLogOpen} />
      <SavedExamplesDialog open={examplesOpen} onOpenChange={setExamplesOpen} />
    </div>
  );
}

/** What needs attention, under the toolbar. The most urgent notice is always
 *  visible; the rest fold into "+N more" so a stack of notices never eats a
 *  small window. */
export function NoticeStack({
  state,
  offline,
  onSettings,
}: {
  state: PmoState;
  offline: boolean;
  onSettings: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const notices = buildNotices(state, offline);
  if (notices.length === 0) return null;
  const shown = expanded ? notices : notices.slice(0, 1);

  const toggle =
    notices.length > 1 ? (
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="text-ink-soft hover:text-ink focus-visible:ring-focus rounded-chip ml-auto shrink-0 px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap underline-offset-2 outline-none hover:underline focus-visible:ring-2"
      >
        {expanded ? "Show fewer" : `+${notices.length - 1} more`}
      </button>
    ) : null;

  return (
    <section
      aria-label="Notices"
      className={cn(
        "scroll-thin flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto pb-3",
        GUTTER_X,
      )}
    >
      {shown.map((notice, index) => (
        <NoticeRow
          key={notice.id}
          notice={notice}
          onSettings={onSettings}
          trailing={index === 0 ? toggle : null}
        />
      ))}
    </section>
  );
}

/** One notice as a banner: the accent tint for information, amber when
 *  something needs attention. */
function NoticeRow({
  notice,
  onSettings,
  trailing,
}: {
  notice: Notice;
  onSettings: () => void;
  trailing?: ReactNode;
}) {
  const attention = notice.level === "attention";
  const Icon = attention ? WarningCircleIcon : InfoIcon;
  return (
    <p
      className={cn(
        "rounded-card text-ink-soft flex items-start gap-2.5 px-4 py-2.5 text-[13px] leading-snug break-words",
        attention ? "bg-amber-soft" : "bg-accent-soft",
      )}
    >
      <Icon
        size={18}
        weight={attention ? "fill" : "regular"}
        className={cn("mt-px shrink-0", attention ? "text-amber" : "text-accent-ink")}
      />
      <span className="min-w-0 flex-1">
        {notice.text}
        {notice.action === "settings" && (
          <>
            {" "}
            <button
              type="button"
              onClick={onSettings}
              className="text-ink focus-visible:ring-focus rounded font-semibold underline underline-offset-2 outline-none focus-visible:ring-2"
            >
              Open settings
            </button>
          </>
        )}
      </span>
      {trailing}
    </p>
  );
}
