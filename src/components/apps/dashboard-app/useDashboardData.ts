"use client";

import { useEffect, useRef, useState } from "react";
import type { RosterEvent, RosterMember } from "@/lib/staff/types";
import {
  REPORT_TASKS,
  reportStatuses,
  type ReportStatusRow,
  type RunLike,
} from "@/lib/dashboard/summary";
import { fetchTaskHistory, fetchTasks } from "../tasks-app/api";
import { listReports } from "../pmo-todo-app/api";

/** The current time, refreshed every minute so "today" and the waiting days move on. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Runs `load` now and then every `everyMs` while the page is visible. The latest
 *  `load` is always the one called, without restarting the timer when it changes. */
function usePolling(load: () => Promise<void>, everyMs: number): void {
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled && document.visibilityState !== "hidden") void latest.current();
    };
    run();
    const id = setInterval(run, everyMs);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
}

export interface Roster {
  members: Pick<RosterMember, "id" | "name" | "employeeId">[];
  events: RosterEvent[];
}

const NO_ROSTER: Roster = { members: [], events: [] };

async function loadRoster(): Promise<Roster | null> {
  try {
    const response = await fetch("/api/staff/roster", { cache: "no-store" });
    const body = (await response.json()) as {
      ok?: boolean;
      config?: { members?: Roster["members"]; events?: RosterEvent[] };
    };
    return body.ok && body.config
      ? { members: body.config.members ?? [], events: body.config.events ?? [] }
      : null;
  } catch {
    return null;
  }
}

/** The shift roster's people and holidays (needed to name leave days it marks). */
export function useRoster(): Roster {
  const [roster, setRoster] = useState<Roster>(NO_ROSTER);
  usePolling(async () => {
    const next = await loadRoster();
    if (next) setRoster(next);
  }, 60_000);
  return roster;
}

export interface ReportStatuses {
  /** null until the first answer arrives. */
  rows: ReportStatusRow[] | null;
  /** The Tasks engine answered (false = it is not running). */
  engineUp: boolean | null;
  /** Each report task's run history, for health and week-over-week. */
  histories: Record<string, readonly RunLike[] | undefined>;
}

type Tasks = Awaited<ReturnType<typeof fetchTasks>>;
type Saved = Awaited<ReturnType<typeof listReports>>;

interface ReportData {
  tasks: Tasks | null;
  histories: Record<string, readonly RunLike[] | undefined>;
  saved: Saved | null;
  answered: boolean;
}

/** The report tasks' state and last run, and the saved weekly reports. */
export function useReportStatuses(now: Date, timeZone: string): ReportStatuses {
  const [data, setData] = useState<ReportData>({
    tasks: null,
    histories: {},
    saved: null,
    answered: false,
  });

  usePolling(async () => {
    const [tasks, saved] = await Promise.all([
      fetchTasks().catch(() => null),
      listReports().catch(() => null),
    ]);
    const histories: ReportData["histories"] = {};
    if (tasks) {
      await Promise.all(
        REPORT_TASKS.filter((known) => tasks.some((t) => t.id === known.id)).map(
          async (known) => {
            histories[known.id] = await fetchTaskHistory(known.id).catch(() => undefined);
          },
        ),
      );
    }
    setData({ tasks, histories, saved, answered: true });
  }, 15_000);

  const rows = data.answered
    ? reportStatuses({
        tasks: data.tasks,
        histories: data.histories,
        saved: data.saved?.ok ? data.saved.reports : null,
        now,
        timeZone,
      })
    : null;
  return {
    rows,
    engineUp: data.answered ? data.tasks !== null : null,
    histories: data.histories,
  };
}
