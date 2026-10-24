"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { Button, IconButton, Input } from "@/components/ui";
import { CHECKPOINT_TEMPLATE_LIST } from "@/lib/pmo/checkpointTemplates";
import { PRIORITIES, type TodoDraft } from "@/lib/pmo/types";
import { Chip, Field, Segmented, TextArea } from "./parts";

interface DraftFormProps {
  draft: TodoDraft;
  onChange: (draft: TodoDraft) => void;
  /** Shown beside the due date while it is still the model's value. */
  dueBasis?: "explicit" | "inferred" | "none" | null;
  disabled?: boolean;
}

/** The editable to-do fields, shared by the review dialog and "New to-do". */
export function DraftForm({ draft, onChange, dueBasis, disabled }: DraftFormProps) {
  const set = (patch: Partial<TodoDraft>) => onChange({ ...draft, ...patch });
  const template = CHECKPOINT_TEMPLATE_LIST.find(
    (t) => t.id === draft.checkpointTemplate,
  );

  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Title">
        <Input
          value={draft.title}
          disabled={disabled}
          maxLength={200}
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <Field label="Description">
        <TextArea
          value={draft.description}
          disabled={disabled}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Owner">
          <Input
            value={draft.owner.name ?? ""}
            disabled={disabled}
            placeholder="Who does the work"
            onChange={(event) =>
              set({ owner: { ...draft.owner, name: event.target.value || null } })
            }
          />
        </Field>
        <Field label="Requester">
          <Input
            value={draft.requester.name ?? ""}
            disabled={disabled}
            placeholder="Who asked"
            onChange={(event) =>
              set({ requester: { ...draft.requester, name: event.target.value || null } })
            }
          />
        </Field>
      </div>

      <label className="text-ink-soft flex items-center gap-2.5 text-[13px]">
        <input
          type="checkbox"
          checked={draft.owner.isMe === true}
          disabled={disabled}
          onChange={(event) =>
            set({ owner: { ...draft.owner, isMe: event.target.checked } })
          }
          className="accent-accent focus-visible:ring-focus h-4 w-4 focus-visible:ring-2"
        />
        This is mine (I am the owner)
      </label>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Due date">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={draft.dueAt ?? ""}
              disabled={disabled}
              onChange={(event) => set({ dueAt: event.target.value || null })}
            />
            {draft.dueAt && dueBasis === "inferred" && (
              <Chip className="shrink-0">guessed</Chip>
            )}
          </div>
        </Field>
        <Field label="Waiting on">
          <Input
            value={draft.waitingOn ?? ""}
            disabled={disabled}
            placeholder="Nobody"
            onChange={(event) => set({ waitingOn: event.target.value || null })}
          />
        </Field>
      </div>

      <Field label="Priority">
        <Segmented
          value={draft.priority}
          disabled={disabled}
          onChange={(priority) => set({ priority })}
          options={PRIORITIES.map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          }))}
        />
      </Field>

      <Field label="Checkpoints">
        <Segmented
          value={draft.checkpointTemplate}
          disabled={disabled}
          onChange={(checkpointTemplate) => set({ checkpointTemplate })}
          options={CHECKPOINT_TEMPLATE_LIST.map((t) => ({
            value: t.id,
            label: t.label,
            title: t.hint,
          }))}
        />
        {template && (
          <span className="text-ink-muted text-[12px]">
            {template.steps.map((step) => step.label).join(" → ")}
          </span>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-ink-muted text-[11px] font-bold tracking-[0.08em] uppercase">
          Action items
        </span>
        {draft.actionItems.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item.text}
              disabled={disabled}
              maxLength={200}
              onChange={(event) =>
                set({
                  actionItems: draft.actionItems.map((existing, i) =>
                    i === index ? { ...existing, text: event.target.value } : existing,
                  ),
                })
              }
            />
            <IconButton
              aria-label="Remove action item"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                set({ actionItems: draft.actionItems.filter((_, i) => i !== index) })
              }
            >
              <XIcon size={14} />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="self-start"
          onClick={() =>
            set({
              actionItems: [...draft.actionItems, { text: "", owner: null, dueAt: null }],
            })
          }
        >
          <PlusIcon size={13} weight="bold" />
          Add action item
        </Button>
      </div>
    </div>
  );
}
