"use client";

import { useEffect, useState } from "react";
import { fetchRegister } from "@/components/apps/toolkit/registersApi";
import type { FieldValue, RegisterRecord } from "@/lib/registers/types";

export interface RegisterRecords {
  items: RegisterRecord[];
  config: Record<string, FieldValue>;
}

/** One register's records for a Dashboard card, read when `enabled` and again every minute and whenever
 *  `refreshKey` changes (the Refresh button). `null` until the first read works; a failed read keeps the last
 *  good records and sets `failed`. Read only: the Dashboard never writes a register. */
export function useRegisterRecords(
  id: string,
  enabled: boolean,
  refreshKey = 0,
): { data: RegisterRecords | null; failed: boolean } {
  const [data, setData] = useState<RegisterRecords | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const load = async () => {
      const reply = await fetchRegister(id);
      if (!current) return;
      if (reply.ok) {
        setData({ items: reply.items, config: reply.config });
        setFailed(false);
      } else setFailed(true);
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [id, enabled, refreshKey]);
  return { data, failed };
}
