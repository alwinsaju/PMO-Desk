"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, FileTextIcon, PlusIcon } from "@phosphor-icons/react";
import { Badge, Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/notifications/toastStore";
import {
  KIND_LABEL,
  type Template,
  type TemplateInput,
  type TemplateKind,
} from "@/lib/templates/types";
import { targetByKey, targetLabel } from "@/lib/templates/targets";
import { buildPack, readPack } from "@/lib/templates/pack";
import { snippetKey } from "@/lib/templates/render";
import { lastUsedText } from "@/lib/templates/usage";
import { usedByBadge, usedByCount } from "@/lib/templates/listView";
import { useTemplateUsage } from "@/lib/templates/usageStore";
import { useDockRecents } from "@/components/taskbar/dockRecentsStore";
import { useTemplatesNav } from "./templatesNavStore";
import { TemplateExtrasDialog } from "./TemplateExtrasDialog";
import { TemplateKindIcon } from "./TemplateKindIcon";
import { VersionsDrawer } from "./VersionsDrawer";
import { FilterPill, Note, PanelMessage, ScrollBody } from "../pmo-todo-app/parts";
import { ConfirmDialog } from "../staff-app/parts";
import { handleRowKey } from "../rowNav";
import {
  createTemplate,
  deleteTemplate,
  fetchLibrary,
  saveTemplate,
  type LibraryPayload,
} from "./api";
import { TemplateEditor } from "./TemplateEditor";
import { blankDraft, copyOf, draftOf, restoreInput, type Draft } from "./templateForm";

type Filter = "all" | TemplateKind;

/** What the right-hand side shows: a saved template, or a new one (`n` makes each new form its own). */
type Selection = { type: "saved"; id: string } | { type: "new"; n: number; seed: Draft };

type Library =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | ({ status: "ready" } & LibraryPayload);

/** Reads the library once, and again when the window is focused (an edit elsewhere
 *  shows up), or when asked to. */
function useLibrary() {
  const [library, setLibrary] = useState<Library>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const reply = await fetchLibrary();
      setLibrary(
        reply.ok
          ? {
              status: "ready",
              templates: reply.templates,
              targets: reply.targets,
              starters: reply.starters,
              dir: reply.dir,
            }
          : { status: "error", reason: reply.reason },
      );
    } catch {
      setLibrary((previous) =>
        previous.status === "ready"
          ? previous
          : { status: "error", reason: "Could not reach the app server." },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { library, reload: load };
}

const usedByText = (template: Template): string => {
  const labels = template.usedBy
    .map((key) => targetByKey(key))
    .filter((t) => !!t)
    .map((t) => targetLabel(t));
  return labels.length > 2
    ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`
    : labels.join(", ");
};

/** The quiet third line of a list entry: how a snippet is used, when it last made a draft, its tags. */
function listNote(template: Template, usedAt: string | undefined): string {
  const use =
    template.kind === "snippet"
      ? `Use as {{> ${snippetKey(template.name)}}}`
      : usedAt
        ? lastUsedText(usedAt, new Date())
        : "";
  return [use, template.tags?.join(", ")].filter(Boolean).join(" · ");
}

/**
 * Root Templates window, registered as "templates" (see apps/index.ts). The email
 * and report templates that tasks and apps use instead of wording kept in a task
 * folder: pick or write one, choose which tasks and apps use it, and the next draft
 * they make follows it. Nothing here sends anything; it only sets the wording of
 * drafts that a person still reviews.
 */
export function TemplatesApp({ windowId }: { windowId: string }) {
  const { library, reload } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switchTo, setSwitchTo] = useState<Selection | null>(null);
  const [newCount, setNewCount] = useState(0);
  // Only matters in a narrow window, where the list and the editor take turns.
  const [listOpen, setListOpen] = useState(true);

  const templates = useMemo(
    () => (library.status === "ready" ? library.templates : []),
    [library],
  );
  const visible = templates.filter(
    (t) =>
      (filter === "all" || t.kind === filter) &&
      (!tagFilter || (t.tags ?? []).includes(tagFilter)),
  );
  const allTags = useMemo(
    () =>
      [...new Set(templates.flatMap((t) => t.tags ?? []))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [templates],
  );
  const usage = useTemplateUsage((s) => s.used);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [packNote, setPackNote] = useState<string | null>(null);

  const exportPack = () => {
    const pack = buildPack(
      templates,
      visible.map((t) => t.id),
      new Date().toISOString(),
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `templates-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    setPackNote(
      `Exported ${pack.templates.length} template${pack.templates.length === 1 ? "" : "s"}.`,
    );
  };

  const importPack = async (file: File | undefined) => {
    if (!file || library.status !== "ready") return;
    const result = readPack(
      await file.text(),
      templates.map((t) => t.name),
    );
    if (!result.ok) return setPackNote(result.reason);
    let made = 0;
    for (const input of result.templates) {
      const reply = await createTemplate(input).catch(() => null);
      if (reply && reply.ok) made += 1;
    }
    await reload();
    setPackNote(
      `Imported ${made} template${made === 1 ? "" : "s"}${result.skipped.length ? `; skipped ${result.skipped.join(", ")}` : ""}. None is used anywhere until you choose.`,
    );
  };
  const selected =
    selection?.type === "saved"
      ? (templates.find((t) => t.id === selection.id) ?? null)
      : null;

  // The first template is open when the window opens.
  const firstId = templates[0]?.id;
  useEffect(() => {
    if (selection === null && firstId) setSelection({ type: "saved", id: firstId });
  }, [selection, firstId]);

  const select = (next: Selection) => {
    if (dirty) setSwitchTo(next);
    else go(next);
  };

  const go = (next: Selection) => {
    if (next.type === "saved") {
      // Dock menu > Recent (q-22).
      const opened = templates.find((t) => t.id === next.id);
      if (opened) {
        useDockRecents
          .getState()
          .remember("templates", { id: opened.id, title: opened.name });
      }
    }
    setSelection(next);
    setListOpen(false);
    setVersionsOpen(false);
    setDirty(false);
    setError(null);
    setFields(null);
    setNotice(null);
  };

  // Dock menu > Recent (q-22): show the template it asked for once the library is loaded, and
  // keep the saved list in step (a deleted template drops out, a renamed one shows its new name).
  const openRequest = useTemplatesNav((s) => s.openRequest);
  const clearOpenRequest = useTemplatesNav((s) => s.clearOpenRequest);
  useEffect(() => {
    if (library.status !== "ready") return;
    const names = new Map(templates.map((t) => [t.id, t.name]));
    useDockRecents.getState().sync("templates", (id) => names.get(id));
    if (!openRequest) return;
    if (names.has(openRequest.templateId)) {
      setFilter("all");
      setTagFilter(null);
      select({ type: "saved", id: openRequest.templateId });
    }
    clearOpenRequest(openRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select changes every render; this runs per request or library change
  }, [openRequest, library.status, templates, clearOpenRequest]);

  const startNew = (
    seed: Draft = blankDraft(filter === "report" ? "report" : "email"),
  ) => {
    const n = newCount + 1;
    setNewCount(n);
    select({ type: "new", n, seed });
  };

  const save = async (input: TemplateInput) => {
    if (library.status !== "ready") return;
    setBusy(true);
    setError(null);
    setFields(null);
    try {
      const reply =
        selection?.type === "saved"
          ? await saveTemplate(selection.id, input)
          : await createTemplate(input);
      if (!reply.ok) {
        setError(reply.reason);
        setFields(reply.fields ?? null);
        return;
      }
      await reload();
      setSelection({ type: "saved", id: reply.template.id });
      setDirty(false);
      setNotice(savedNotice(reply.template, reply.displaced));
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const gone = selected;
    setBusy(true);
    try {
      const reply = await deleteTemplate(gone.id);
      if (!reply.ok) {
        setError(reply.reason);
        return;
      }
      setSelection(null);
      setVersionsOpen(false);
      setDirty(false);
      await reload();
      setNotice(null);
      toast({
        key: `undo-${gone.id}`,
        message: `Deleted “${gone.name}”. What used it goes back to its own wording.`,
        durationMs: 10_000,
        action: { label: "Undo", run: () => void restore(gone) },
      });
    } catch {
      setError("Could not reach the app server.");
    } finally {
      setBusy(false);
    }
  };

  /** Puts a deleted template back (as a new copy of everything the person could set) and opens it. */
  const restore = async (gone: Template) => {
    try {
      const reply = await createTemplate(restoreInput(gone));
      if (!reply.ok) {
        toast({ tone: "danger", message: reply.reason });
        return;
      }
      await reload();
      go({ type: "saved", id: reply.template.id });
    } catch {
      toast({ tone: "danger", message: "Could not reach the app server." });
    }
  };

  const confirmSwitch = () => {
    if (switchTo) go(switchTo);
    setSwitchTo(null);
  };

  return (
    <div
      data-window-id={windowId}
      className="@container relative flex h-full w-full flex-col overflow-hidden"
    >
      {library.status === "loading" && <PanelMessage>Loading templates…</PanelMessage>}
      {library.status === "error" && (
        <PanelMessage>
          {library.reason}{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            className="ml-1"
          >
            Try again
          </Button>
        </PanelMessage>
      )}
      {library.status === "ready" && (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Templates"
            className={cn(
              "border-line shrink-0 flex-col border-r @2xl:flex @2xl:w-[17.5rem]",
              // In a narrow window the list and the editor take turns.
              listOpen ? "flex w-full" : "hidden",
            )}
          >
            <div className="flex flex-col gap-3 px-4 pt-1 pb-3">
              <Button onClick={() => startNew()} data-testid="template-new">
                <PlusIcon size={14} weight="bold" />
                New template
              </Button>
              <div
                className="grid grid-cols-2 gap-1.5 [&>button]:justify-between"
                role="group"
                aria-label="Filter templates"
              >
                {(["all", "email", "report", "snippet"] as const).map((value) => (
                  <FilterPill
                    key={value}
                    active={filter === value}
                    onClick={() => setFilter(value)}
                    count={
                      value === "all"
                        ? templates.length
                        : templates.filter((t) => t.kind === value).length
                    }
                  >
                    {value === "all" ? "All" : KIND_LABEL[value]}
                  </FilterPill>
                ))}
              </div>
              {allTags.length > 0 && (
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Filter by tag"
                  data-testid="tag-filter"
                >
                  {allTags.map((tag) => (
                    <FilterPill
                      key={tag}
                      active={tagFilter === tag}
                      onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    >
                      {tag}
                    </FilterPill>
                  ))}
                </div>
              )}
            </div>
            <ScrollBody className="px-3 pb-4">
              <ul
                className="flex flex-col gap-1.5"
                onKeyDown={(event) =>
                  handleRowKey(
                    event,
                    Array.from(
                      event.currentTarget.querySelectorAll<HTMLElement>(
                        "[data-template-item]",
                      ),
                    ),
                    (event.target as HTMLElement)
                      .closest("li")
                      ?.querySelector<HTMLElement>("[data-template-item]") ?? null,
                  )
                }
              >
                {selection?.type === "new" && (
                  <li>
                    <div className="bg-accent-soft text-accent-ink rounded-control px-3 py-2.5 text-[13.5px] font-semibold">
                      New template (not saved)
                    </div>
                  </li>
                )}
                {visible.map((template) => {
                  const active =
                    selection?.type === "saved" && selection.id === template.id;
                  const note = listNote(template, usage[template.id]);
                  const badge = usedByBadge(
                    usedByCount(template, templates, template.id),
                    template.kind,
                  );
                  return (
                    <li key={template.id}>
                      <button
                        type="button"
                        data-template-item
                        onClick={() => select({ type: "saved", id: template.id })}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "rounded-control transition-ui flex w-full items-start gap-2.5 px-3 py-2.5 text-left",
                          "focus-visible:ring-focus focus-visible:ring-2 focus-visible:outline-none",
                          active ? "bg-accent-soft" : "hover:bg-chip",
                        )}
                      >
                        <TemplateKindIcon kind={template.kind} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-center gap-2">
                            {/* The list cuts long names off, so the full name shows on hover and focus. */}
                            <Tooltip
                              label={template.name}
                              side="right"
                              className="max-w-72 break-words"
                            >
                              <span className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                                {template.name}
                              </span>
                            </Tooltip>
                            <Badge
                              variant={badge.tone}
                              className="h-5 shrink-0 px-2 text-[11px]"
                              data-testid="template-used-by"
                            >
                              {badge.label}
                            </Badge>
                          </span>
                          {template.kind !== "snippet" && template.usedBy.length > 0 && (
                            <span className="text-ink-muted line-clamp-2 text-[12px] leading-snug">
                              {usedByText(template)}
                            </span>
                          )}
                          {note && (
                            <span
                              className="text-ink-faint text-[11.5px]"
                              data-testid="template-usage"
                            >
                              {note}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {visible.length === 0 && selection?.type !== "new" && (
                  <li className="text-ink-muted px-3 py-6 text-center text-[13px]">
                    No templates of this type yet.
                  </li>
                )}
              </ul>
            </ScrollBody>
            <div className="border-line flex flex-col gap-1.5 border-t px-3 py-2.5">
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={exportPack}
                  data-testid="pack-export"
                >
                  Export pack
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <label className="cursor-pointer">
                    Import pack
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      aria-label="Import a template pack"
                      onChange={(e) => {
                        void importPack(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Button>
              </div>
              {packNote && (
                <p
                  className="text-ink-muted text-[11.5px]"
                  role="status"
                  data-testid="pack-note"
                >
                  {packNote}
                </p>
              )}
            </div>
          </nav>

          <section
            className={cn(
              "min-w-0 flex-1 flex-col @2xl:flex",
              listOpen ? "hidden" : "flex",
            )}
            aria-label="Template editor"
          >
            <div className="px-4 pb-1 @2xl:hidden">
              <Button variant="ghost" size="sm" onClick={() => setListOpen(true)}>
                <ArrowLeftIcon size={14} />
                All templates
              </Button>
            </div>
            {notice && (
              <Note tone="accent" role="status" className="mx-5 mt-1 mb-2 shrink-0">
                {notice}
              </Note>
            )}
            {selection === null && (
              <PanelMessage>
                <FileTextIcon size={28} className="text-accent-ink mx-auto mb-2" />
                Choose a template to edit, or start a new one. Tasks and apps use the ones
                you mark as used by them.
              </PanelMessage>
            )}
            {selection?.type === "saved" && !selected && (
              <PanelMessage>That template no longer exists.</PanelMessage>
            )}
            {(selection?.type === "new" || selected) && (
              <TemplateEditor
                key={selection?.type === "new" ? `new-${selection.n}` : selected?.id}
                template={selected}
                seed={selection?.type === "new" ? selection.seed : draftOf(selected!)}
                templates={templates}
                busy={busy}
                error={error}
                serverFields={fields}
                onDirtyChange={setDirty}
                onSave={(input) => void save(input)}
                onDuplicate={() => selected && startNew(copyOf(selected))}
                onDelete={() => void remove()}
                onOpenExtras={() => setExtrasOpen(true)}
                onOpenVersions={() => setVersionsOpen(true)}
              />
            )}
          </section>
        </div>
      )}

      {selected && versionsOpen && (
        <VersionsDrawer
          key={selected.id}
          template={selected}
          onClose={() => setVersionsOpen(false)}
          onChanged={() => void reload()}
        />
      )}
      {selected && (
        <TemplateExtrasDialog
          template={selected}
          templates={templates}
          open={extrasOpen}
          onOpenChange={setExtrasOpen}
          onChanged={() => void reload()}
        />
      )}
      <ConfirmDialog
        open={switchTo !== null}
        title="Discard your changes?"
        description="This template has changes that are not saved."
        confirmLabel="Discard changes"
        onConfirm={confirmSwitch}
        onOpenChange={(open) => !open && setSwitchTo(null)}
      />
    </div>
  );
}

/** "Saved. Aging Report · Email draft now uses it (it replaced “Old”)." */
function savedNotice(
  template: Template,
  displaced: { templateName: string; targetKey: string }[],
): string {
  const moved = displaced
    .map(
      (d) =>
        `${targetByKey(d.targetKey) ? targetLabel(targetByKey(d.targetKey)!) : d.targetKey} (was “${d.templateName}”)`,
    )
    .join(", ");
  return moved
    ? `Saved “${template.name}”. It now also covers ${moved}.`
    : `Saved “${template.name}”.`;
}
