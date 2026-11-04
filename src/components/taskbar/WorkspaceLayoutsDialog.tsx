"use client";

import { useState, type FormEvent } from "react";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Switch,
} from "@/components/ui";
import { useWindowStore } from "@/components/window-manager";
import { toast } from "@/lib/notifications/toastStore";
import { usePreferences } from "@/lib/preferences/preferencesStore";
import {
  MAX_LAYOUT_NAME,
  MAX_WORKSPACE_LAYOUTS,
  type WorkspaceLayout,
} from "@/lib/preferences/schema";
import { builtInApps, toolApps } from "./pinnedApps";
import {
  deleteLayout,
  layoutSizeOf,
  renameLayout,
  restoreLayout,
  saveCurrentLayout,
} from "./workspaceLayoutActions";
import { useWorkspaceLayoutsUi } from "./workspaceLayoutsUi";

const appTitle = (appId: string): string =>
  [...builtInApps, ...toolApps].find((a) => a.id === appId)?.title ?? appId;

const appsText = (layout: WorkspaceLayout): string =>
  layout.windows.map((w) => appTitle(w.appId)).join(", ");

/**
 * "Workspace layouts": save the open apps and where their windows are under a name, bring one
 * back, rename it, delete it. Opened from Quick settings (the "Workspace layouts" row); mounted
 * once from SettingsMenu.tsx. Restoring is a click action: it never closes a window, and it
 * writes the window store once (the same commit-once rule as drag and resize).
 */
export function WorkspaceLayoutsDialog() {
  const open = useWorkspaceLayoutsUi((s) => s.open);
  const closeLayouts = useWorkspaceLayoutsUi((s) => s.closeLayouts);
  const layouts = usePreferences((s) => s.workspaceLayouts);
  // Apps a layout saved right now would hold (a number, so this only re-renders when it changes).
  const openApps = useWindowStore((s) => (open ? layoutSizeOf(s.windows) : 0));

  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [minimizeOthers, setMinimizeOthers] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const full = layouts.length >= MAX_WORKSPACE_LAYOUTS;

  const reset = () => {
    setName("");
    setError("");
    setRenaming(null);
    setRenameError("");
    setConfirmDelete(null);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const result = saveCurrentLayout(name);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setName("");
    setError("");
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (renaming === null) return;
    const result = renameLayout(renaming, renameValue);
    if (!result.ok) {
      setRenameError(result.reason);
      return;
    }
    setRenaming(null);
    setRenameError("");
  };

  const restore = (layout: WorkspaceLayout) => {
    const message = restoreLayout(layout, minimizeOthers);
    toast({ key: "workspace-layout", tone: "info", title: layout.name, message });
    closeLayouts();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          closeLayouts();
        }
      }}
    >
      <DialogContent
        className="max-h-[88vh] max-w-lg overflow-y-auto"
        aria-describedby="workspace-layouts-intro"
      >
        <DialogTitle>Workspace layouts</DialogTitle>
        <DialogDescription id="workspace-layouts-intro">
          Save the apps you have open and where their windows are, then bring that
          arrangement back later. Restoring never closes anything.
        </DialogDescription>

        <form onSubmit={save} className="mt-5 flex flex-col gap-2" noValidate>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="Name this layout"
              aria-label="Layout name"
              aria-invalid={error ? true : undefined}
              aria-describedby="workspace-layouts-save-hint"
              maxLength={MAX_LAYOUT_NAME * 2}
              disabled={full}
            />
            <Button type="submit" disabled={full || openApps === 0}>
              Save current
            </Button>
          </div>
          <p
            id="workspace-layouts-save-hint"
            role={error ? "alert" : "status"}
            className={error ? "text-red text-[13px]" : "text-ink-muted text-[13px]"}
          >
            {error ||
              (full
                ? `${MAX_WORKSPACE_LAYOUTS} of ${MAX_WORKSPACE_LAYOUTS} saved. Delete one to save another.`
                : openApps === 0
                  ? "Open an app first, then save the layout."
                  : `Saves the ${openApps === 1 ? "1 app" : `${openApps} apps`} open now and where their windows are.`)}
          </p>
        </form>

        <h3 className="text-ink-muted mt-6 text-[12px] font-semibold tracking-wide uppercase">
          Saved layouts
        </h3>
        {layouts.length === 0 ? (
          <p className="text-ink-muted mt-2 text-sm">No layouts saved yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" aria-label="Saved layouts">
            {layouts.map((layout) => (
              <li
                key={layout.name}
                className="bg-card border-line rounded-card flex flex-col gap-2 border p-3"
              >
                {renaming === layout.name ? (
                  <form onSubmit={rename} className="flex flex-col gap-1.5" noValidate>
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => {
                          setRenameValue(e.target.value);
                          setRenameError("");
                        }}
                        aria-label={`New name for ${layout.name}`}
                        aria-invalid={renameError ? true : undefined}
                        maxLength={MAX_LAYOUT_NAME * 2}
                      />
                      <Button type="submit" size="md">
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setRenaming(null);
                          setRenameError("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {renameError ? (
                      <p role="alert" className="text-red text-[13px]">
                        {renameError}
                      </p>
                    ) : null}
                  </form>
                ) : confirmDelete === layout.name ? (
                  <div className="flex items-center gap-2">
                    <p className="text-ink min-w-0 flex-1 text-sm break-words">
                      Delete &ldquo;{layout.name}&rdquo;? The apps and windows stay as
                      they are.
                    </p>
                    <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        deleteLayout(layout.name);
                        setConfirmDelete(null);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-ink truncate text-sm font-semibold">
                        {layout.name}
                      </p>
                      <p
                        className="text-ink-muted truncate text-[12.5px]"
                        title={appsText(layout)}
                      >
                        {appsText(layout)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => restore(layout)}
                      aria-label={`Restore ${layout.name}`}
                    >
                      Restore
                    </Button>
                    <IconButton
                      size="sm"
                      aria-label={`Rename ${layout.name}`}
                      onClick={() => {
                        setRenaming(layout.name);
                        setRenameValue(layout.name);
                        setRenameError("");
                        setConfirmDelete(null);
                      }}
                    >
                      <PencilSimpleIcon aria-hidden />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete ${layout.name}`}
                      onClick={() => {
                        setConfirmDelete(layout.name);
                        setRenaming(null);
                      }}
                    >
                      <TrashIcon aria-hidden />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <label className="mt-5 flex cursor-pointer items-center gap-3">
          <Switch
            checked={minimizeOthers}
            onCheckedChange={setMinimizeOthers}
            aria-label="Minimise my other open windows when restoring"
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-ink text-sm font-semibold">
              Minimise my other open windows
            </span>
            <span className="text-ink-muted text-[12.5px]">
              Off by default: windows a layout does not mention stay where they are. On,
              they are minimised, not closed.
            </span>
          </span>
        </label>
      </DialogContent>
    </Dialog>
  );
}
