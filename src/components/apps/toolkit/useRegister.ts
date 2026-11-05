"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldValue, InvalidRecord, RegisterRecord } from "@/lib/registers/types";
import { publishSummary } from "./publishSummary";
import {
  changeRegister,
  fetchRegister,
  type RecordInput,
  type RegisterReply,
} from "./registersApi";

const REFRESH_MS = 30_000;

export interface RegisterState {
  items: RegisterRecord[];
  /** Records in the file that fail the checks. They are kept as they are until repaired or removed. */
  invalid: InvalidRecord[];
  config: Record<string, FieldValue>;
  loaded: boolean;
  error: { reason: string; detail?: string } | null;
  /** Add or replace records; resolves to the saved records, or the reason it failed. */
  save: (records: RecordInput[]) => Promise<RegisterReply<{ items: RegisterRecord[] }>>;
  remove: (ids: string[]) => Promise<RegisterReply>;
  saveConfig: (config: Record<string, FieldValue>) => Promise<RegisterReply>;
  reload: () => Promise<void>;
}

/** One register's records, loaded from the server and refreshed every half minute. */
export function useRegister(id: string): RegisterState {
  const [items, setItems] = useState<RegisterRecord[]>([]);
  const [invalid, setInvalid] = useState<InvalidRecord[]>([]);
  const [config, setConfig] = useState<Record<string, FieldValue>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<RegisterState["error"]>(null);
  const writing = useRef(0);
  /** Bumped by every write, so a read that started before it cannot bring older data back. */
  const version = useRef(0);

  const reload = useCallback(async () => {
    const started = version.current;
    const reply = await fetchRegister(id);
    if (writing.current > 0 || version.current !== started) return;
    if (reply.ok) {
      setItems(reply.items);
      setInvalid(reply.invalid ?? []);
      setConfig(reply.config);
      setError(null);
      setLoaded(true);
    } else setError({ reason: reply.reason, detail: reply.detail });
  }, [id]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const write = useCallback(
    async (changes: Parameters<typeof changeRegister>[1]) => {
      writing.current += 1;
      version.current += 1;
      const reply = await changeRegister(id, changes);
      version.current += 1;
      writing.current -= 1;
      if (reply.ok) {
        setItems(reply.items);
        setInvalid(reply.invalid ?? []);
        setConfig(reply.config);
        setError(null);
        publishSummary(id, reply);
      }
      return reply;
    },
    [id],
  );

  return {
    items,
    invalid,
    config,
    loaded,
    error,
    save: (records) => write({ upsert: records }),
    remove: (ids) => write({ remove: ids }),
    saveConfig: (next) => write({ config: next }),
    reload,
  };
}
