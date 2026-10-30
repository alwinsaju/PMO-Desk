"use client";

import { useEffect, useState } from "react";
import { fetchState } from "@/components/apps/pmo-todo-app/api";
import { myFirstName } from "@/lib/pmo/signoffRequest";

let cached: Promise<string> | null = null;

/** The person's first name from the PMO To-Do settings ("" until known or when none is set), read once. */
export function useMyFirstName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    let cancelled = false;
    cached ??= fetchState()
      .then((state) => myFirstName(state.config.me))
      .catch(() => {
        cached = null;
        return "";
      });
    void cached.then((n) => {
      if (!cancelled) setName(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return name;
}
