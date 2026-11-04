"use client";

import { useEffect, useState } from "react";
import { projectSuggestions } from "@/lib/registers/records";
import { fetchRegister } from "./registersApi";

/** The project names in the status-report register, for a form's Project suggestions. Reads the
 *  register once when `enabled`; if that fails there are simply no suggestions. */
export function useProjectNames(enabled: boolean): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void fetchRegister("status-report").then((reply) => {
      if (current && reply.ok) setNames(projectSuggestions(reply.items));
    });
    return () => {
      current = false;
    };
  }, [enabled]);
  return names;
}
