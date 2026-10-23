"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  ScrollArea,
} from "@/components/ui";
import type { ReviewIncident } from "./types";

interface ReviewIncidentDialogProps {
  /** null closes the dialog. */
  incident: ReviewIncident | null;
  /** Full Subcategory2 vocabulary for the searchable picker. */
  options: string[];
  /** Called with the chosen Subcategory2 when the human saves. */
  onResolve: (number: string, subcategory2: string) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail view for one incident that needs a human-chosen Subcategory2.
 * Shows exactly the fields prepare_data.py surfaces for classification
 * (short description, resolution notes, category/subcategory, state,
 * assignment group/assignee) and a searchable picker over the proven
 * Subcategory2 vocabulary. Saving hands the choice back to the parent
 * ReviewPanel, which stages it for the batch POST.
 */
export function ReviewIncidentDialog({
  incident,
  options,
  onResolve,
  onOpenChange,
}: ReviewIncidentDialogProps) {
  const [lastIncident, setLastIncident] = useState<ReviewIncident | null>(incident);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (incident) {
      setLastIncident(incident);
      setSelected(incident.resolved_subcategory2 ?? null);
      setQuery("");
    }
  }, [incident]);

  // A resolved value that isn't in the vocabulary (a new label from an
  // import) still has to show up — and stay selected — in the picker.
  const allOptions = useMemo(
    () => (selected && !options.includes(selected) ? [selected, ...options] : options),
    [options, selected],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((option) => option.toLowerCase().includes(q));
  }, [allOptions, query]);

  // #4: the two long-text fields are clamped to 3 lines by default; clicking
  // one expands it to show the full note. Tracked by field label.
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleExpand = (label: string) =>
    setExpanded((current) => (current === label ? null : label));

  const fields: [string, string | null][] = lastIncident
    ? [
        ["Short description", lastIncident.short_description],
        ["Resolution notes", lastIncident.resolution_notes],
        ["Category", lastIncident.category],
        ["Subcategory", lastIncident.subcategory],
        ["State", lastIncident.state],
        ["Assignment group", lastIncident.assignment_group],
        ["Assigned to", lastIncident.assigned_to],
      ]
    : [];

  return (
    <Dialog open={incident !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        {lastIncident && (
          <>
            <DialogTitle className="font-mono">{lastIncident.number}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5">
                {lastIncident.review_reasons.map((reason) => (
                  <Badge key={reason} variant="accent">
                    {reason}
                  </Badge>
                ))}
              </div>
            </DialogDescription>

            <div className="border-border/60 mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border p-3 sm:grid-cols-2">
              {fields.map(([label, value]) => {
                const expandable =
                  (label === "Short description" || label === "Resolution notes") &&
                  Boolean(value);
                const isExpanded = expanded === label;
                return (
                  <div
                    key={label}
                    className={"min-w-0 " + (isExpanded ? "sm:col-span-2" : "")}
                  >
                    <p className="text-ink-faint text-[10px] font-semibold tracking-wide uppercase">
                      {label}
                    </p>
                    {expandable ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(label)}
                        title={isExpanded ? "Click to collapse" : "Click to read in full"}
                        className="text-ink hover:text-accent-800 w-full text-left text-[12px] break-words whitespace-pre-wrap"
                      >
                        <span className={isExpanded ? "" : "line-clamp-3 block"}>
                          {value}
                        </span>
                        <span className="text-ink-faint text-[10px]">
                          {isExpanded ? " (show less)" : " (more)"}
                        </span>
                      </button>
                    ) : (
                      <p className="text-ink line-clamp-3 text-[12px] break-words">
                        {value ?? <span className="text-ink-faint">—</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <p className="text-ink-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
                Subcategory2
              </p>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search categories…"
                className="mb-2 h-9"
              />
              <ScrollArea className="border-border/60 h-48 rounded-lg border">
                <div className="flex flex-col p-1">
                  {filtered.length === 0 ? (
                    <p className="text-ink-faint p-3 text-[12px]">No categories match.</p>
                  ) : (
                    filtered.map((option) => {
                      const active = option === selected;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setSelected(option)}
                          className={
                            "ease-standard rounded-control px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100 " +
                            (active
                              ? "bg-accent-subtle text-accent-800 font-medium"
                              : "text-ink hover:bg-neutral-100")
                          }
                        >
                          {option}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-ink-faint text-[11px]">
                {selected ? (
                  <>
                    Will save as <span className="text-ink font-medium">{selected}</span>
                  </>
                ) : (
                  "Pick a Subcategory2 to resolve this incident."
                )}
              </p>
              <Button
                disabled={!selected}
                onClick={() => {
                  if (lastIncident && selected) {
                    onResolve(lastIncident.number, selected);
                    onOpenChange(false);
                  }
                }}
              >
                Save resolution
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
