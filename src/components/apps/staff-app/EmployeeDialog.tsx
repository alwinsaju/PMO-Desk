"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  Avatar,
  Button,
  ChipInput,
  Dialog,
  DialogContent,
  FormField,
  Switch,
  ValidationSummary,
  addedHeadline,
} from "@/components/ui";
import {
  createEmployee,
  distinctValues,
  employeeFromEmail,
  newRosterPerson,
  hasErrors,
  initials,
  isValidEmail,
  nameFromEmail,
  photoUrl,
  validateEmployee,
  type EmployeeErrors,
} from "@/lib/staff/employees";
import { useStaffStore } from "@/lib/staff/staffStore";
import {
  GENDERS,
  LOCATIONS,
  type Employee,
  type OffboardedEmployee,
} from "@/lib/staff/types";
import {
  DialogHead,
  DialogScroll,
  FormSection,
  StickyFooter,
  ValidatedInput,
} from "./FormParts";
import { SELECT_CLASS } from "./parts";
import { resizeToAvatar } from "./resizeToAvatar";

type TextKey =
  | "firstName"
  | "lastName"
  | "deloitteEmail"
  | "phone"
  | "level"
  | "offering"
  | "op"
  | "team"
  | "clientManager"
  | "birthday"
  | "homeOffice"
  | "milestone"
  | "deloittePersonId"
  | "networkId"
  | "workdayId"
  | "takedaEmail"
  | "rollOffDate"
  | "staffitStartDate"
  | "staffitEndDate"
  | "contractEndDate";

/** Fields with a rule worth confirming with a tick once they pass it. */
const CHECKED_KEYS: readonly TextKey[] = ["deloitteEmail", "takedaEmail", "milestone"];

export function EmployeeDialog({
  open,
  employee,
  kind = "employees",
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** The person being edited; null to add someone. */
  employee: Employee | null;
  /** Which list the person lives in: the roster, or the offboarded list. */
  kind?: "employees" | "offboarded";
  onOpenChange: (open: boolean) => void;
  /** Called with the id of the person saved last. */
  onSaved: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogBody
            key={employee?.id ?? "new"}
            employee={employee}
            kind={kind}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function DialogBody({
  employee,
  kind,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  kind: "employees" | "offboarded";
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [mode, setMode] = useState<"quick" | "form">(employee ? "form" : "quick");
  return mode === "quick" ? (
    <QuickAdd onClose={onClose} onSaved={onSaved} onManual={() => setMode("form")} />
  ) : (
    <EmployeeForm employee={employee} kind={kind} onClose={onClose} onSaved={onSaved} />
  );
}

function ErrorLine({ children }: { children: string }) {
  return (
    <p role="alert" className="text-red flex items-start gap-2 text-[13px]">
      <WarningCircleIcon size={16} className="mt-px shrink-0" />
      {children}
    </p>
  );
}

function QuickAdd({
  onClose,
  onSaved,
  onManual,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
  onManual: () => void;
}) {
  const employees = useStaffStore((s) => s.employees);
  const commit = useStaffStore((s) => s.commit);
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useMemo(
    () => new Set(employees.map((e) => e.deloitteEmail.toLowerCase())),
    [employees],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const problemWith = (email: string) =>
    !isValidEmail(email)
      ? "Not an email address."
      : known.has(email.toLowerCase())
        ? "Already on the roster; skipped."
        : null;
  const fresh = emails.filter((email) => problemWith(email) === null);

  async function add() {
    setBusy(true);
    setError(null);
    const people = fresh.map((email) => employeeFromEmail(email));
    const result = await commit("employees", { upsert: people });
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    onSaved(people[people.length - 1].id);
    onClose();
  }

  const n = fresh.length;
  return (
    <>
      <DialogHead
        title="Add employees"
        description="Enter their Deloitte email. Name, level, offering portfolio, home office, phone and profile picture are filled in from their M365 profile."
      />
      <DialogScroll>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>fieldset]:mt-0">
          <FormSection title="Who">
            <FormField
              label="Deloitte email(s)"
              hint="Type or paste several at once: separate them with a comma, a space or a new line."
              className="sm:col-span-2"
            >
              {(control) => (
                <ChipInput
                  {...control}
                  ref={inputRef}
                  values={emails}
                  onChange={setEmails}
                  validate={problemWith}
                  normalize={(raw) => raw.replace(/^[<"']+|[>"']+$/g, "")}
                  noun="email"
                  placeholder="first.last@deloitte.com"
                />
              )}
            </FormField>
            {emails.length > 0 && (
              <ValidationSummary
                className="sm:col-span-2"
                headline={addedHeadline(n, "person", "people")}
              />
            )}
          </FormSection>
          <FormSection title="What happens next">
            <ol className="text-ink-soft flex list-decimal flex-col gap-2 pl-4 text-[13px] sm:col-span-2">
              <li>They appear in the Directory straight away.</li>
              <li>
                Their Microsoft 365 profile is requested; the details fill in once the
                flow has run.
              </li>
              <li>
                An onboarding checklist starts for them under Insights, in Checklists.
              </li>
            </ol>
          </FormSection>
        </div>
        {error && (
          <div className="mt-4">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}
      </DialogScroll>
      <StickyFooter
        note={
          <Button variant="ghost" size="sm" onClick={onManual}>
            Enter all details instead
          </Button>
        }
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={n === 0 || busy} onClick={() => void add()}>
          {n > 1 ? `Add ${n} people` : "Add employee"}
        </Button>
      </StickyFooter>
    </>
  );
}

function EmployeeForm({
  employee,
  kind,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  kind: "employees" | "offboarded";
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const roster = useStaffStore((s) => s.employees);
  const offboarded = useStaffStore((s) => s.offboarded);
  const commit = useStaffStore((s) => s.commit);
  const uploadPhoto = useStaffStore((s) => s.uploadPhoto);
  const removePhoto = useStaffStore((s) => s.removePhoto);

  const [draft, setDraft] = useState<Employee>(
    () => employee ?? (kind === "employees" ? newRosterPerson() : createEmployee()),
  );
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );

  const suggestions = useMemo(() => {
    const people = [...roster, ...offboarded];
    return {
      level: distinctValues(people, "level"),
      op: distinctValues(people, "op"),
      offering: distinctValues(people, "offering"),
      team: distinctValues(people, "team"),
      homeOffice: distinctValues(people, "homeOffice"),
    };
  }, [roster, offboarded]);

  // Offboarded people may share an email (someone who left and came back), so only the roster is checked.
  const errors: EmployeeErrors = useMemo(
    () => validateEmployee(draft, kind === "employees" ? roster : []),
    [draft, kind, roster],
  );

  const set = <K extends keyof Employee>(key: K, value: Employee[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function text(
    key: TextKey,
    label: string,
    options: {
      type?: string;
      list?: keyof typeof suggestions;
      hint?: string;
      placeholder?: string;
      className?: string;
    } = {},
  ) {
    const error = errors[key as keyof EmployeeErrors] ?? null;
    return (
      <FormField
        label={label}
        error={error}
        showErrorNow={submitted}
        hint={options.hint}
        className={options.className}
      >
        {(control) => (
          <ValidatedInput
            control={control}
            error={error}
            checked={CHECKED_KEYS.includes(key)}
            type={options.type}
            value={draft[key]}
            placeholder={options.placeholder}
            list={options.list ? `staff-list-${options.list}` : undefined}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </FormField>
    );
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await resizeToAvatar(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
      setPhotoRemoved(false);
      setFormError(null);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "That image could not be used.",
      );
    }
  }

  async function save() {
    const email = draft.deloitteEmail.trim();
    const names =
      draft.firstName.trim() || draft.lastName.trim()
        ? { firstName: draft.firstName.trim(), lastName: draft.lastName.trim() }
        : nameFromEmail(email);
    const prepared: Employee = {
      ...draft,
      ...names,
      deloitteEmail: email,
      milestone: draft.milestone.trim(),
    };
    const found = validateEmployee(prepared, kind === "employees" ? roster : []);
    if (hasErrors(found)) return setSubmitted(true);

    setBusy(true);
    setFormError(null);
    const saved =
      kind === "offboarded"
        ? await commit("offboarded", { upsert: [prepared as OffboardedEmployee] })
        : await commit("employees", { upsert: [prepared] });
    if (!saved.ok) {
      setBusy(false);
      return setFormError(saved.reason);
    }
    const photoResult = photo
      ? await uploadPhoto(prepared.id, photo.blob)
      : photoRemoved && prepared.photoVersion > 0
        ? await removePhoto(prepared.id)
        : null;
    setBusy(false);
    if (photoResult && !photoResult.ok) {
      return setFormError(`Saved, but the photo was not updated: ${photoResult.reason}`);
    }
    onSaved(prepared.id);
    onClose();
  }

  const shownPhoto = photo?.preview ?? (photoRemoved ? undefined : photoUrl(draft));
  const editing = employee !== null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHead
        title={editing ? "Edit employee" : "Add employee"}
        description={
          editing
            ? "Name, level, offering portfolio, home office, phone and the picture normally come from the person's Microsoft 365 profile; change them here only if the profile is wrong or empty."
            : "Fill in what you know. Their Microsoft 365 profile is requested as soon as you save, and name, level, offering portfolio, home office, phone and the picture are filled in from it (values it has replace what is typed here)."
        }
      />
      <DialogScroll>
        <div className="flex items-center gap-4">
          <Avatar
            src={shownPhoto}
            alt=""
            fallback={initials(draft)}
            className="h-[72px] w-[72px] text-2xl"
          />
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <CameraIcon size={14} weight="bold" />
                {shownPhoto ? "Change photo" : "Upload photo"}
              </Button>
              {shownPhoto && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhoto(null);
                    setPhotoRemoved(true);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-ink-muted text-[12px]">
              Normally pulled from M365. JPEG, PNG or WebP.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="mt-6">
          <FormSection title="Identity">
            {text("firstName", "First name")}
            {text("lastName", "Last name")}
            {text("deloitteEmail", "Deloitte email", {
              type: "email",
              className: "sm:col-span-2",
            })}
            {text("phone", "Phone", { type: "tel" })}
            <FormField label="Gender" hint="Kept on file only; never shown in lists.">
              {(control) => (
                <select
                  {...control}
                  className={SELECT_CLASS}
                  value={draft.gender}
                  onChange={(e) => set("gender", e.target.value)}
                >
                  <option value="">Not set</option>
                  {GENDERS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              )}
            </FormField>
          </FormSection>

          <FormSection title="Work">
            {text("level", "Level", { list: "level" })}
            {text("op", "Offering portfolio", { list: "op" })}
            {text("offering", "Offering", { list: "offering" })}
            {text("team", "Team", { list: "team" })}
            {text("clientManager", "Client manager")}
            {text("birthday", "Birthday (MM-DD)", { placeholder: "e.g. 03-14" })}
            <FormField label="Location">
              {(control) => (
                <select
                  {...control}
                  className={SELECT_CLASS}
                  value={draft.location}
                  onChange={(e) =>
                    set("location", e.target.value as Employee["location"])
                  }
                >
                  <option value="">Not set</option>
                  {LOCATIONS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              )}
            </FormField>
            {text("homeOffice", "Home office", {
              list: "homeOffice",
              hint: "The city, as Teams shows it (for example Bengaluru).",
            })}
            {text("milestone", "Milestone", {
              placeholder: "e.g. 2027",
              hint: "Year set for promotion.",
            })}
            <FormField
              label="Skills"
              hint="Type a skill and press Enter or a comma."
              className="sm:col-span-2"
            >
              {(control) => (
                <ChipInput
                  {...control}
                  values={draft.skills}
                  onChange={(skills) => set("skills", skills)}
                  noun="skill"
                  placeholder="Add a skill"
                />
              )}
            </FormField>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <label
                htmlFor="emp-campus"
                className="text-ink-soft text-[13px] font-semibold"
              >
                Campus recruit
              </label>
              <Switch
                id="emp-campus"
                checked={draft.campus}
                onCheckedChange={(checked) => set("campus", checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <label
                htmlFor="emp-exclude-shifts"
                className="text-ink-soft text-[13px] font-semibold"
              >
                Exclude from the shift roster
              </label>
              <Switch
                id="emp-exclude-shifts"
                checked={draft.excludeFromShiftRoster}
                onCheckedChange={(checked) => set("excludeFromShiftRoster", checked)}
              />
            </div>
          </FormSection>

          <FormSection title="Dates">
            {text("rollOffDate", "Roll-off date", { type: "date" })}
            {text("contractEndDate", "Contract end date", { type: "date" })}
            {text("staffitStartDate", "Staffit start date", { type: "date" })}
            {text("staffitEndDate", "Staffit end date", { type: "date" })}
          </FormSection>

          <FormSection title="Identifiers">
            {text("deloittePersonId", "Deloitte Person ID")}
            {text("networkId", "Network ID")}
            {text("workdayId", "Workday ID")}
            {text("takedaEmail", "Takeda email", { type: "email" })}
          </FormSection>
        </div>

        {(["level", "op", "offering", "team", "homeOffice"] as const).map((key) => (
          <datalist key={key} id={`staff-list-${key}`}>
            {suggestions[key].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        ))}

        {formError && (
          <div className="mt-4">
            <ErrorLine>{formError}</ErrorLine>
          </div>
        )}
      </DialogScroll>
      <StickyFooter
        note={
          submitted &&
          hasErrors(errors) && (
            <p role="alert" className="text-red flex items-center gap-2">
              <WarningCircleIcon size={16} className="shrink-0" />
              Fix the highlighted fields to save.
            </p>
          )
        }
      >
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {editing ? "Save changes" : "Add employee"}
        </Button>
      </StickyFooter>
    </form>
  );
}
