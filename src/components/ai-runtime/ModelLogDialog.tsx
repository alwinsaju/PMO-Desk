"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  buildPlainTimeline,
  filterEvents,
  filterLines,
  formatClock,
  formatRawLine,
  plainToText,
  type LevelFilter,
  type PlainEntry,
  type PlainTone,
} from "@/lib/ai-runtime/logView";
import type { AiLogEvent } from "@/lib/ai-runtime/log";
import type { ServerLogTail } from "@/lib/ai-runtime/serverLog";
import { loadModel, unloadModel } from "./api";
import { ModelStatusCard } from "./ModelStatusCard";
import { useModelLog } from "./useModelLog";

type View = "plain" | "raw";
type RawSource = "events" | "server";

export interface ModelLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TONE_DOT: Record<PlainTone, string> = {
  info: "bg-ink-faint",
  good: "bg-success-dot",
  warn: "bg-amber",
  bad: "bg-red",
  muted: "bg-line-strong",
};
const TONE_TEXT: Record<PlainTone, string> = {
  info: "text-ink",
  good: "text-ink",
  warn: "text-ink",
  bad: "text-red",
  muted: "text-ink-muted",
};
const LEVEL_TEXT = {
  info: "text-ink-soft",
  warn: "text-amber",
  error: "text-red",
} as const;

/**
 * What the local model has been doing this session, readable. A dialog any app
 * can open (`<ModelLogDialog open onOpenChange />`): the PMO toolbar's model chip
 * does today. It shows the current state with Load now / Unload now, then either
 * a plain-English timeline or the raw event lines (plus the tail of Ollama's own
 * server log), both built from the same events. Polls only while open.
 */
export function ModelLogDialog({ open, onOpenChange }: ModelLogDialogProps) {
  const [view, setView] = useState<View>("plain");
  const [source, setSource] = useState<RawSource>("events");
  const [follow, setFollow] = useState(true);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The log's scroll box, as state: the dialog's content mounts a moment after
  // `open` flips, and Follow must scroll as soon as the box exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const wantServerLog = open && view === "raw" && source === "server";
  const { data, error, refresh } = useModelLog(open, wantServerLog);
  const { events, status, serverLog, sessionStartedAt, skewMs } = data;

  const plain = useMemo(() => buildPlainTimeline(events), [events]);
  const rawEvents = useMemo(
    () => filterEvents(events, { level, text }),
    [events, level, text],
  );
  const serverLines = useMemo(
    () => (serverLog ? filterLines(serverLog.lines, text) : []),
    [serverLog, text],
  );

  const shownCount =
    view === "plain"
      ? plain.length
      : source === "events"
        ? rawEvents.length
        : serverLines.length;

  // Follow: keep the newest line in view. Layout effect so the jump happens
  // before paint (no flicker); anything else leaves the scroll position alone.
  useLayoutEffect(() => {
    if (follow && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [follow, scroller, shownCount, view, source, open]);

  // Scrolling up switches Follow off; the switch turns it back on.
  const onScroll = () => {
    if (!scroller) return;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 28) {
      setFollow(false);
    }
  };

  // Each time the dialog opens it follows the newest line again.
  useEffect(() => {
    if (open) setFollow(true);
  }, [open]);

  // A result line under the buttons fades after a few seconds.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(id);
  }, [note]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function act(run: typeof loadModel, done: Record<string, string>) {
    setBusy(true);
    setNote(null);
    try {
      const reply = await run();
      setNote(reply.ok ? (done[reply.state] ?? "Done.") : reply.reason);
      refresh();
    } catch {
      setNote("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  }

  const sessionLine = sessionStartedAt
    ? `This session began at ${formatClock(sessionStartedAt)}, when PMO Desk's server started. Kept in memory only: cleared when PMO Desk restarts, never saved to disk.`
    : "This session's log is kept in memory only: cleared when PMO Desk restarts, never saved to disk.";

  /** The text of what is on screen (for Copy and Download). */
  const exportText = (): string => {
    const head = [
      "PMO Desk local model log",
      sessionStartedAt
        ? `Session started ${new Date(sessionStartedAt).toISOString()}`
        : "",
    ].filter(Boolean);
    if (view === "plain") return [...head, "", plainToText(plain)].join("\n");
    if (source === "server") {
      const where = serverLog?.source.path ? ` (${serverLog.source.path})` : "";
      return [
        ...head,
        `Source: ${serverLog?.source.label ?? "Ollama server log"}${where}`,
        "",
        ...serverLines,
      ].join("\n");
    }
    return [
      ...head,
      "Source: PMO Desk runtime events (this session)",
      "",
      ...rawEvents.map(formatRawLine),
    ].join("\n");
  };

  async function copy() {
    const value = exportText();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        area.remove();
      }
    }
    setCopied(true);
  }

  function download() {
    const blob = new Blob([exportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-os-model-log-${view === "raw" && source === "server" ? "ollama" : view}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,820px)] max-h-full max-w-3xl flex-col px-5 pt-6 pb-5 sm:px-7">
        <DialogTitle className="shrink-0 text-[20px]">
          What the model is doing
        </DialogTitle>
        <DialogDescription className="shrink-0 text-[12.5px] leading-relaxed">
          {sessionLine}
        </DialogDescription>

        {/* Everything between the title and the footer scrolls as one in a short
            window; the log itself keeps a minimum height of its own. */}
        <div className="scroll-thin mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          <ModelStatusCard
            status={status}
            skewMs={skewMs}
            busy={busy}
            note={note}
            onLoad={() =>
              void act(loadModel, {
                started:
                  "Waking the model. This can take a minute or two; the log shows when it is ready.",
                "already-loaded": "The model is already loaded.",
                "already-loading": "The model is already waking up.",
              })
            }
            onUnload={() =>
              void act(unloadModel, {
                unloaded: "Model unloaded; its memory is free.",
                "already-asleep": "The model was already asleep.",
              })
            }
          />

          {error && (
            <p
              role="alert"
              className="bg-amber-soft text-ink-soft rounded-card px-3.5 py-2 text-[12.5px]"
            >
              {error} Showing what was last received.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList aria-label="Log view">
                <TabsTrigger value="plain">Plain English</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
              </TabsList>
            </Tabs>
            <label className="text-ink-soft ml-auto flex items-center gap-2 text-[13px] font-semibold">
              Follow
              <Switch
                checked={follow}
                onCheckedChange={setFollow}
                aria-label="Follow the newest line"
              />
            </label>
          </div>

          {view === "raw" && (
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={source} onValueChange={(v) => setSource(v as RawSource)}>
                <TabsList aria-label="Raw source">
                  <TabsTrigger value="events">PMO Desk events</TabsTrigger>
                  <TabsTrigger value="server">Ollama server log</TabsTrigger>
                </TabsList>
              </Tabs>
              {source === "events" && (
                <select
                  aria-label="Level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as LevelFilter)}
                  className="rounded-control border-line-strong bg-field text-ink focus-visible:border-focus focus-visible:shadow-field-focus h-9 border px-3 text-[13px] focus-visible:outline-none"
                >
                  <option value="all">All levels</option>
                  <option value="warn">Warnings and errors</option>
                  <option value="error">Errors only</option>
                </select>
              )}
              <Input
                aria-label="Filter lines"
                placeholder="Filter text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-w-32 flex-1"
              />
            </div>
          )}
          {view === "raw" && (
            <p className="text-ink-muted -mt-1 text-[12px] leading-snug break-words">
              {source === "events" ? (
                <>
                  <strong className="text-ink-soft">Source:</strong> PMO Desk runtime
                  events for this session (what PMO Desk asked Ollama, and when). No
                  message text is logged.
                </>
              ) : (
                <>
                  <strong className="text-ink-soft">Source:</strong>{" "}
                  {serverLog?.source.label ?? "Ollama's server log"}. Read-only; the last{" "}
                  {serverLog?.lines.length ?? 0} lines
                  {serverLog?.truncated ? " (older lines are cut off)" : ""}.
                  {serverLog?.source.path && (
                    <span className="[overflow-wrap:anywhere]">
                      {" "}
                      File: {serverLog.source.path}
                    </span>
                  )}
                </>
              )}
            </p>
          )}

          <div
            ref={setScroller}
            onScroll={onScroll}
            role="log"
            aria-label={
              view === "plain" ? "Model activity, plain English" : "Model activity, raw"
            }
            tabIndex={0}
            className={cn(
              "scroll-thin border-line bg-card rounded-card focus-visible:ring-focus min-h-48 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain border p-3 outline-none focus-visible:ring-2",
            )}
          >
            {view === "plain" ? (
              <PlainList entries={plain} />
            ) : source === "events" ? (
              <RawList events={rawEvents} total={events.length} />
            ) : (
              <ServerLogList
                tail={serverLog}
                lines={serverLines}
                loading={!serverLog && !error}
              />
            )}
          </div>
        </div>

        <div className="border-line mt-3 flex shrink-0 flex-wrap items-center gap-2.5 border-t pt-3.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copy()}
            disabled={shownCount === 0}
          >
            {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={download}
            disabled={shownCount === 0}
          >
            <DownloadSimpleIcon size={14} />
            Download .txt
          </Button>
          <span className="text-ink-muted ml-auto text-[12px]">
            {shownCount}{" "}
            {view === "plain" ? "lines" : source === "events" ? "events" : "log lines"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlainList({ entries }: { entries: PlainEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-ink-muted p-3 text-[13px] leading-relaxed">
        Nothing yet this session. The model is not used until a message needs it, so a
        quiet log is normal.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-2.5"
        >
          <time
            dateTime={new Date(entry.ts).toISOString()}
            className="text-ink-muted pt-px text-[12px] tabular-nums"
          >
            {formatClock(entry.ts)}
          </time>
          <p
            className={cn(
              "flex items-start gap-2 text-[13px] leading-snug",
              TONE_TEXT[entry.tone],
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                TONE_DOT[entry.tone],
                entry.pending && "motion-safe:animate-blink",
              )}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{entry.text}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

const MONO =
  "font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]";

function RawList({ events, total }: { events: AiLogEvent[]; total: number }) {
  if (events.length === 0) {
    return (
      <p className="text-ink-muted p-3 text-[13px]">
        {total === 0 ? "No events yet this session." : "No events match the filters."}
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {events.map((event) => (
        <li key={event.seq} className={cn(MONO, LEVEL_TEXT[event.level])}>
          {formatRawLine(event)}
        </li>
      ))}
    </ol>
  );
}

function ServerLogList({
  tail,
  lines,
  loading,
}: {
  tail: ServerLogTail | null;
  lines: string[];
  loading: boolean;
}) {
  if (loading) return <p className="text-ink-muted p-3 text-[13px]">Reading the log…</p>;
  if (tail?.unavailable) {
    return (
      <p className="text-ink-muted p-3 text-[13px] leading-relaxed">{tail.unavailable}</p>
    );
  }
  if (lines.length === 0) {
    return <p className="text-ink-muted p-3 text-[13px]">No lines match.</p>;
  }
  return (
    <ol className="flex flex-col">
      {lines.map((line, i) => (
        <li key={i} className={cn(MONO, "text-ink-soft")}>
          {line}
        </li>
      ))}
    </ol>
  );
}
