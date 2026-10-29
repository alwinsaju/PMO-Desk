"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CameraIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Switch,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  createEmployee,
  distinctValues,
  employeeFromEmail,
  hasErrors,
  initials,
  nameFromEmail,
  parseEmailList,
  parseSkills,
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
import { Field, SELECT_CLASS } from "./parts";
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

const TEXTAREA_CLASS = cn(
  "rounded-control border-line-strong bg-field text-ink w-full resize-y border px-3.5 py-2.5 text-sm leading-relaxed",
  "placeholder:text-ink-muted",
  "transition-[border-color,box-shadow] duration-[250ms]",
  "focus-visible:border-focus focus-visible:shadow-field-focus focus-visible:outline-none",
);

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
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const batch = useMemo(() => parseEmailList(text, employees), [text, employees]);

  useEffect(() => {
    let live = true;
    fetch("/api/staff/sync")
      .then((r) => r.json() as Promise<{ folder?: unknown }>)
      .then((body) => {
        if (live && typeof body.folder === "string") setFolder(body.folder);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    const people = batch.valid.map((email) => employeeFromEmail(email));
    const result = await commit("employees", { upsert: people });
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    onSaved(people[people.length - 1].id);
    onClose();
  }

  const n = batch.valid.length;
  return (
    <>
      <DialogTitle>Add employees</DialogTitle>
      <DialogDescription>
        Enter their Deloitte email. Name, level, offering portfolio, home office, phone
        and profile picture are filled in from their M365 profile.
      </DialogDescription>
      {folder && (
        <p className="text-ink-muted mt-2 text-[12px] leading-snug">
          The profile is requested through{" "}
          <code className="[overflow-wrap:anywhere]">
            {folder.split(/(?<=\\)/).map((part, index) => (
              <Fragment key={index}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </code>
          .
        </p>
      )}
      <div className="mt-5 flex flex-col gap-3">
        <Field
          label="Deloitte email(s)"
          htmlFor="staff-emails"
          hint="One per line, or separated by commas."
        >
          <textarea
            id="staff-emails"
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="first.last@deloitte.com"
            className={TEXTAREA_CLASS}
          />
        </Field>
        {text.trim() && (
          <ul className="text-ink-muted flex flex-col gap-1 text-[12.5px]">
            <li>
              {n} new {n === 1 ? "person" : "people"} will be added
            </li>
            {batch.duplicates.length > 0 && (
              <li>Already on the roster, skipped: {batch.duplicates.join(", ")}</li>
            )}
            {batch.invalid.length > 0 && (
              <li className="text-red">
                Not an email address: {batch.invalid.join(", ")}
              </li>
            )}
          </ul>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
      <DialogFooter className="items-center justify-between">
        <Button variant="ghost" onClick={onManual}>
          Enter all details instead
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={n === 0 || busy} onClick={() => void add()}>
            {n > 1 ? `Add ${n} people` : "Add employee"}
          </Button>
        </div>
      </DialogFooter>
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

  const [draft, setDraft] = useState<Employee>(() => employee ?? createEmployee());
  const [skillsText, setSkillsText] = useState(() => draft.skills.join(", "));
  const [errors, setErrors] = useState<EmployeeErrors>({});
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
    const id = `emp-${key}`;
    return (
      <Field
        label={label}
        htmlFor={id}
        error={errors[key as keyof EmployeeErrors]}
        hint={options.hint}
        className={options.className}
      >
        <Input
          id={id}
          type={options.type}
          value={draft[key]}
          placeholder={options.placeholder}
          list={options.list ? `staff-list-${options.list}` : undefined}
          onChange={(e) => set(key, e.target.value)}
        />
      </Field>
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
      skills: parseSkills(skillsText),
    };
    // Offboarded people may share an email (someone who left and came back), so only the roster is checked.
    const found = validateEmployee(prepared, kind === "employees" ? roster : []);
    setErrors(found);
    if (hasErrors(found)) return;

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
    >
      <DialogTitle>{editing ? "Edit employee" : "Add employee"}</DialogTitle>
      <DialogDescription>
        {editing
          ? "Name, level, offering portfolio, home office, phone and the picture normally come from the person's Microsoft 365 profile; change them here only if the profile is wrong or empty."
          : "Fill in what you know. Name, level, offering portfolio, home office, phone and the picture can be left empty and will come from the Microsoft 365 profile."}
      </DialogDescription>

      <div className="mt-5 flex items-center gap-4">
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

      <FormSection title="Identity">
        {text("firstName", "First name")}
        {text("lastName", "Last name")}
        {text("deloitteEmail", "Deloitte email", {
          type: "email",
          className: "sm:col-span-2",
        })}
        {text("phone", "Phone", { type: "tel" })}
        <Field
          label="Gender"
          htmlFor="emp-gender"
          hint="Kept on file only; never shown in lists."
        >
          <select
            id="emp-gender"
            className={SELECT_CLASS}
            value={draft.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            <option value="">Not set</option>
            {GENDERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Work">
        {text("level", "Level", { list: "level" })}
        {text("op", "Offering portfolio", { list: "op" })}
        {text("offering", "Offering", { list: "offering" })}
        {text("team", "Team", { list: "team" })}
        {text("clientManager", "Client manager")}
        <Field label="Location" htmlFor="emp-location">
          <select
            id="emp-location"
            className={SELECT_CLASS}
            value={draft.location}
            onChange={(e) => set("location", e.target.value as Employee["location"])}
          >
            <option value="">Not set</option>
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        {text("homeOffice", "Home office", {
          list: "homeOffice",
          hint: "The city, as Teams shows it (for example Bengaluru).",
        })}
        {text("milestone", "Milestone", {
          placeholder: "e.g. 2027",
          hint: "Year set for promotion.",
        })}
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <label htmlFor="emp-campus" className="text-ink-soft text-[13px] font-semibold">
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
        <Field
          label="Skills"
          htmlFor="emp-skills"
          hint="Separate with commas."
          className="sm:col-span-2"
        >
          <Input
            id="emp-skills"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
          />
        </Field>
      </FormSection>

      <FormSection title="Engagement">
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {editing ? "Save changes" : "Add employee"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 min-w-0">
      <legend className="text-ink-muted mb-3 text-[11.5px] font-bold tracking-[0.08em] uppercase">
        {title}
      </legend>
      <div className="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
