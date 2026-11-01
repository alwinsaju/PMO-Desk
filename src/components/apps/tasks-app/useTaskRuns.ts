"use client";

import { useEffect, useState } from "react";
import { fetchTaskHistory } from "./api";
import type { HistoryRun, TaskState } from "./types";

/** A task's past runs, read on mount and again whenever its state changes (a run just ended). */
export function useTaskRuns(taskId: string, state: TaskState): HistoryRun[] {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetchTaskHistory(taskId)
      .then((r) => {
        if (!cancelled) setRuns(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taskId, state]);
  return runs;
}
