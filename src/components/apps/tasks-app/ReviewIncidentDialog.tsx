"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { resolveLabel, searchOptions } from "./reviewFlow";
import type { ReviewIncident } from "./types";

interface ReviewIncidentDialogProps {
  /** null closes the dialog. */
  incident: ReviewIncident | null;
  /** Full Subcategory2 vocabulary for the searchable picker. */
  options: string[];
  /** Unresolved incidents left in the queue (including this one). */
  pendingCount: number;
  /** Other unresolved incidents with the same Short description. */
  similarCount: number;
  /** Called the moment the human picks a category (no separate save click). */
  onResolve: (number: string, subcategory2: string, applyToSimilar: boolean) => void;
  /** Previous / next incident, for browsing without resolving. */
  onNavigate: (direction: 1 | -1) => void;
  onOpenChange: (open: boolean) => void;
}

const CONFIDENCE_VARIANT = { high: "success", medium: "accent", low: "warning" } as const;

/**
 * Detail view for one incident that needs a human-chosen Subcategory2.
 * Picking a category saves it straight away and moves on to the next
 * unresolved incident; the local AI model's suggestion (when there is one) is
 * one click or Enter away, and a category that isn't in the list can be added
 * by typing it. The choice is staged by the parent ReviewPanel, which saves
 * automatically.
 */
export function ReviewIncidentDialog({
  incident,
  options,
  pendingCount,
  similarCount,
  onResolve,
  onNavigate,
  onOpenChange,
}: ReviewIncidentDialogProps) {
  const [lastIncident, setLastIncident] = useState<ReviewIncident | null>(incident);
  const [query, setQuery] = useState("");
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (incident) {
      setLastIncident(incident);
      setQuery("");
      setFormError(null);
      searchRef.current?.focus();
    }
  }, [incident]);

  const selected = lastIncident?.resolved_subcategory2 ?? null;
  const suggestion = lastIncident?.ai_suggestion ?? null;

  // A resolved value that isn't in the vocabulary (a new label from an
  // import or one just added) still has to show up in the picker.
  const allOptions = useMemo(
    () => (selected && !options.includes(selected) ? [selected, ...options] : options),
    [options, selected],
  );

  const { matches, canAdd, similar } = useMemo(
    () => searchOptions(allOptions, query),
    [allOptions, query],
  );

  const choose = (typed: string) => {
    if (!lastIncident) return;
    const checked = resolveLabel(typed, allOptions);
    if (!checked.ok) {
      setFormError(checked.reason);
      return;
    }
    onResolve(lastIncident.number, checked.label, applyToSimilar && similarCount > 0);
  };

  // Enter: the top search match, else the existing spelling of what was typed, else
  // add what was typed, else the AI suggestion.
  const handleEnter = () => {
    if (query.trim()) {
      if (matches.length > 0) choose(matches[0]);
      else choose(query);
    } else if (suggestion) {
      choose(suggestion.label);
    }
  };

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
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col px-[30px] pt-7 pb-6">
        {lastIncident && (
          <>
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle className="font-mono text-[21px]">
                {lastIncident.number}
              </DialogTitle>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-ink-muted mr-1 text-xs">
                  {pendingCount === 0 ? "All done" : `${pendingCount} left`}
                </span>
                <Button variant="outline" size="sm" onClick={() => onNavigate(-1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNavigate(1)}>
                  Next
                </Button>
              </div>
            </div>

            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5">
                {lastIncident.review_reasons.map((reason) => (
                  <Badge key={reason} variant="warning">
                    {reason}
                  </Badge>
                ))}
              </div>
            </DialogDescription>

            <div className="border-line bg-card rounded-card mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border p-4 sm:grid-cols-2">
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
                    <p className="text-ink-muted text-[10.5px] font-bold tracking-[0.08em] uppercase">
                      {label}
                    </p>
                    {expandable ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(label)}
                        title={isExpanded ? "Click to collapse" : "Click to read in full"}
                        className="text-ink hover:text-accent-ink w-full text-left text-[13px] break-words whitespace-pre-wrap"
                      >
                        <span className={isExpanded ? "" : "line-clamp-3 block"}>
                          {value}
                        </span>
                        <span className="text-ink-muted text-[11px]">
                          {isExpanded ? " (show less)" : " (more)"}
                        </span>
                      </button>
                    ) : (
                      <p className="text-ink line-clamp-3 text-[13px] break-words">
                        {value ?? <span className="text-ink-muted">—</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {suggestion && (
              <div className="border-line bg-accent-soft rounded-card mt-4 flex items-center justify-between gap-3 border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-ink-muted text-[10.5px] font-bold tracking-[0.08em] uppercase">
                    Local AI suggests
                  </p>
                  <p className="text-ink flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                    {suggestion.label}
                    <Badge variant={CONFIDENCE_VARIANT[suggestion.confidence]}>
                      {suggestion.confidence} confidence
                    </Badge>
                    {suggestion.is_new && <Badge variant="warning">new category</Badge>}
                  </p>
                  {suggestion.issue && (
                    <p className="text-ink text-xs">
                      <span className="text-ink-muted">Understood as: </span>
                      {suggestion.issue}
                    </p>
                  )}
                  {suggestion.vote_label &&
                    suggestion.vote_label !== suggestion.label && (
                      <p className="text-ink-soft text-xs">
                        Past similar tickets were usually{" "}
                        <button
                          type="button"
                          className="text-accent-ink font-semibold underline"
                          onClick={() => choose(suggestion.vote_label as string)}
                        >
                          {suggestion.vote_label}
                        </button>
                        {suggestion.vote_share
                          ? ` (${Math.round(suggestion.vote_share * 100)}%)`
                          : ""}
                      </p>
                    )}
                  {suggestion.reason && (
                    <p className="text-ink-soft line-clamp-2 text-xs">
                      {suggestion.reason}
                    </p>
                  )}
                </div>
                <Button
                  className="shrink-0"
                  disabled={selected === suggestion.label}
                  onClick={() => choose(suggestion.label)}
                >
                  {selected === suggestion.label ? "Chosen" : "Use this"}
                </Button>
              </div>
            )}

            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <p className="text-ink-muted mb-2 text-[11px] font-bold tracking-[0.08em] uppercase">
                Subcategory2
              </p>
              <Input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setFormError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleEnter();
                  }
                }}
                placeholder="Search, or type a new category and press Enter…"
                className="mb-2"
              />
              {formError && <p className="text-red mb-2 text-xs">{formError}</p>}
              <ScrollArea className="border-line bg-card rounded-card h-48 border">
                <div className="flex flex-col p-1">
                  {similar && (
                    <button
                      type="button"
                      onClick={() => choose(similar)}
                      className="rounded-control text-accent-ink hover:bg-chip px-3 py-2 text-left text-[13.5px] font-semibold transition-colors duration-200"
                    >
                      Use existing “{similar}” (same category as “{query.trim()}”)
                    </button>
                  )}
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() => choose(query)}
                      className="rounded-control text-accent-ink hover:bg-chip px-3 py-2 text-left text-[13.5px] font-semibold transition-colors duration-200"
                    >
                      + Add “{query.trim()}” as a new category
                    </button>
                  )}
                  {matches.length === 0 && !canAdd && !similar ? (
                    <p className="text-ink-muted p-3.5 text-[13px]">
                      No categories match.
                    </p>
                  ) : (
                    matches.map((option) => {
                      const active = option === selected;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => choose(option)}
                          className={
                            "rounded-control px-3 py-2 text-left text-[13.5px] transition-colors duration-200 " +
                            (active
                              ? "bg-accent-soft text-accent-ink font-semibold"
                              : "text-ink hover:bg-chip")
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
              {similarCount > 0 ? (
                <label className="text-ink-soft flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={applyToSimilar}
                    onChange={(event) => setApplyToSimilar(event.target.checked)}
                  />
                  Also apply to {similarCount} other pending incident
                  {similarCount === 1 ? "" : "s"} with the same description or almost the
                  same resolution notes
                </label>
              ) : (
                <p className="text-ink-muted text-xs">
                  Pick a category to save it and jump to the next incident.
                </p>
              )}
              {selected && (
                <p className="text-ink-muted shrink-0 text-xs">
                  Saved as <span className="text-ink font-medium">{selected}</span>
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
