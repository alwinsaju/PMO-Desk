// The roster on disk: one JSON file per collection plus one file per photo, in
// `<data dir>/staff`. Server only. The employee list in `employees.json` is the
// source other apps (and the tasks engine) read instead of an uploaded Excel.
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { mutexFor, readJsonSafe, writeJsonAtomic } from "../pmo/server/fsx.ts";
import { resolveDataDir } from "../pmo/server/paths.ts";
import { mergeChanges } from "./changes.ts";
import {
  applyProfile,
  EMPLOYEE_ID,
  findByEmail,
  settleProfileSync,
} from "./employees.ts";
import {
  checkPhoto,
  decodeBase64Photo,
  sniffPhotoType,
  type PhotoType,
} from "./photo.ts";
import {
  employeeChangesSchema,
  moveSchema,
  offboardedChangesSchema,
  profileSchema,
  rosterConfigSchema,
  rosterImportSchema,
  shiftChangesSchema,
  timeOffChangesSchema,
} from "./schema.ts";
import { defaultRosterConfig } from "./rosterCatalog.ts";
import type {
  Employee,
  OffboardedEmployee,
  RosterConfig,
  ShiftAssignment,
  StaffKind,
  TimeOffRequest,
} from "./types.ts";

type Env = Record<string, string | undefined>;

export class StaffError extends Error {
  readonly status: 400 | 404 | 500;
  constructor(message: string, status: 400 | 404 | 500 = 400) {
    super(message);
    this.status = status;
  }
}

export const STAFF_KINDS: readonly StaffKind[] = [
  "employees",
  "shifts",
  "timeoff",
  "offboarded",
];

export function staffDir(env: Env = process.env): string {
  return path.join(resolveDataDir(env), "staff");
}

const collectionFile = (kind: StaffKind, env: Env) =>
  path.join(staffDir(env), `${kind}.json`);
const photoFile = (id: string, env: Env) =>
  path.join(staffDir(env), "photos", `${id}.img`);

interface Collections {
  employees: Employee[];
  shifts: ShiftAssignment[];
  timeoff: TimeOffRequest[];
  offboarded: OffboardedEmployee[];
}

async function readCollection<K extends StaffKind>(
  kind: K,
  env: Env,
): Promise<Collections[K]> {
  const read = await readJsonSafe(collectionFile(kind, env));
  if (read.kind === "missing") return [] as Collections[K];
  const items =
    read.kind === "ok" ? (read.value as { items?: unknown })?.items : undefined;
  // A damaged file is reported, never replaced by an empty list that the next save would write over it.
  if (!Array.isArray(items)) {
    throw new StaffError(`The saved ${kind} file could not be read.`, 500);
  }
  return items as Collections[K];
}

async function writeCollection<K extends StaffKind>(
  kind: K,
  items: Collections[K],
  env: Env,
): Promise<void> {
  await writeJsonAtomic(collectionFile(kind, env), { version: 1, items });
}

const withLock = <T>(env: Env, run: () => Promise<T>): Promise<T> =>
  mutexFor(staffDir(env)).run(run);

export function readStaff<K extends StaffKind>(kind: K, env: Env = process.env) {
  return readCollection(kind, env);
}

/** A cheap fingerprint of a collection's file (changes whenever it is written), so a
 *  caller that already holds the current copy can be told so without resending it. */
export async function collectionStamp(
  kind: StaffKind,
  env: Env = process.env,
): Promise<string> {
  try {
    const info = await stat(collectionFile(kind, env));
    return `"${kind}-${Math.round(info.mtimeMs)}-${info.size}"`;
  } catch {
    return `"${kind}-none"`;
  }
}

// ---------------------------------------------------------------------------
// Shift roster configuration (schedules, teams, members, events)
// ---------------------------------------------------------------------------

const rosterFile = (env: Env) => path.join(staffDir(env), "roster.json");

/** The saved configuration, or the starting one (the team's schedules and sections,
 *  nobody in them) when nothing is saved yet. Caller may or may not hold the lock. */
async function readRosterConfig(env: Env): Promise<RosterConfig> {
  const read = await readJsonSafe(rosterFile(env));
  if (read.kind === "missing") return defaultRosterConfig();
  const config =
    read.kind === "ok" ? (read.value as { config?: unknown })?.config : undefined;
  const parsed = rosterConfigSchema.safeParse(config);
  // A damaged file is reported, never replaced by the defaults that the next save would write over it.
  if (!parsed.success) {
    throw new StaffError("The saved shift roster settings could not be read.", 500);
  }
  return parsed.data as RosterConfig;
}

async function writeRosterConfig(config: RosterConfig, env: Env): Promise<void> {
  await writeJsonAtomic(rosterFile(env), { version: 1, config });
}

export function readRoster(env: Env = process.env): Promise<RosterConfig> {
  return readRosterConfig(env);
}

async function checkLinks(config: RosterConfig, env: Env): Promise<void> {
  const people = new Set((await readCollection("employees", env)).map((e) => e.id));
  if (config.members.some((m) => m.employeeId && !people.has(m.employeeId))) {
    throw new StaffError(
      "A person is linked to a profile that is not on the roster.",
      404,
    );
  }
}

/** Replaces the configuration. Assignments of people who are no longer in it are dropped. */
export async function saveRoster(
  body: unknown,
  env: Env = process.env,
): Promise<RosterConfig> {
  const parsed = rosterConfigSchema.safeParse((body as { config?: unknown })?.config);
  if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
  const config = parsed.data as RosterConfig;
  return withLock(env, async () => {
    await checkLinks(config, env);
    const kept = new Set(config.members.map((m) => m.id));
    const shifts = await readCollection("shifts", env);
    if (shifts.some((s) => !kept.has(s.memberId))) {
      await writeCollection(
        "shifts",
        shifts.filter((s) => kept.has(s.memberId)),
        env,
      );
    }
    await writeRosterConfig(config, env);
    return config;
  });
}

/** The workbook import: replaces the configuration and merges the assignments in. */
export async function importRoster(
  body: unknown,
  env: Env = process.env,
): Promise<{ config: RosterConfig; assignments: number }> {
  const parsed = rosterImportSchema.safeParse(body);
  if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
  const config = parsed.data.config as RosterConfig;
  const upsert = (parsed.data.upsert ?? []) as ShiftAssignment[];
  return withLock(env, async () => {
    await checkLinks(config, env);
    const members = new Set(config.members.map((m) => m.id));
    if (upsert.some((a) => !members.has(a.memberId))) {
      throw new StaffError("A shift belongs to someone who is not on the shift roster.");
    }
    const current = (await readCollection("shifts", env)).filter((s) =>
      members.has(s.memberId),
    );
    await writeCollection("shifts", mergeChanges(current, { upsert }), env);
    await writeRosterConfig(config, env);
    return { config, assignments: upsert.length };
  });
}

function firstIssue(error: {
  issues: { message: string; path: PropertyKey[] }[];
}): string {
  const issue = error.issues[0];
  const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
  return `${issue.message}${where}`;
}

async function removePhotos(ids: readonly string[], env: Env): Promise<void> {
  await Promise.all(
    ids
      .filter((id) => EMPLOYEE_ID.test(id))
      .map((id) => rm(photoFile(id, env), { force: true })),
  );
}

/** Drops the time off of people who have left the roster and unlinks their shift
 *  roster entries (the entries and their shifts stay, under the name they had).
 *  Caller holds the lock. */
async function dropSchedules(ids: readonly string[], env: Env): Promise<void> {
  if (!ids.length) return;
  const gone = new Set(ids);
  const leave = await readCollection("timeoff", env);
  if (leave.some((r) => gone.has(r.employeeId))) {
    await writeCollection(
      "timeoff",
      leave.filter((r) => !gone.has(r.employeeId)),
      env,
    );
  }
  const config = await readRosterConfig(env);
  if (config.members.some((m) => m.employeeId && gone.has(m.employeeId))) {
    await writeRosterConfig(
      {
        ...config,
        members: config.members.map((m) =>
          m.employeeId && gone.has(m.employeeId) ? { ...m, employeeId: null } : m,
        ),
      },
      env,
    );
  }
}

const nameKey = (name: string): string =>
  name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(" ");

const personKey = (p: Pick<Employee, "firstName" | "lastName">): string =>
  nameKey(`${p.firstName} ${p.lastName}`);

/** Deleting someone for good also removes their shift roster entry and its shifts.
 *  Offboarding unlinked that entry, so it is found by name (in any order) among the
 *  unlinked ones, and never when someone else still on file has the same name.
 *  Caller holds the lock. */
async function dropRosterEntries(
  gone: readonly OffboardedEmployee[],
  env: Env,
): Promise<void> {
  if (!gone.length) return;
  const ids = new Set(gone.map((p) => p.id));
  const names = new Set(gone.map(personKey));
  const stillHere = new Set(
    [
      ...(await readCollection("employees", env)),
      ...(await readCollection("offboarded", env)),
    ].map(personKey),
  );
  const config = await readRosterConfig(env);
  const dropped = new Set(
    config.members
      .filter((m) =>
        m.employeeId
          ? ids.has(m.employeeId)
          : names.has(nameKey(m.name)) && !stillHere.has(nameKey(m.name)),
      )
      .map((m) => m.id),
  );
  if (!dropped.size) return;
  await writeRosterConfig(
    { ...config, members: config.members.filter((m) => !dropped.has(m.id)) },
    env,
  );
  const shifts = await readCollection("shifts", env);
  if (shifts.some((s) => dropped.has(s.memberId))) {
    await writeCollection(
      "shifts",
      shifts.filter((s) => !dropped.has(s.memberId)),
      env,
    );
  }
}

/** Applies a batch of upserts/removals to one collection, all or nothing, and
 *  returns the collection as saved. Removing a person also removes their shifts,
 *  time off and photo; for the offboarded list, removing deletes the profile for good,
 *  with their photo and shift roster entry. */
export function applyChanges<K extends StaffKind>(
  kind: K,
  body: unknown,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<Collections[K]> {
  return withLock(env, async () => {
    if (kind === "employees") {
      const parsed = employeeChangesSchema.safeParse(body);
      if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
      const current = await readCollection("employees", env);
      const stored = new Map(current.map((e) => [e.id, e]));
      const stamp = now();
      const upsert = (parsed.data.upsert ?? []).map((e) => {
        const before = stored.get(e.id);
        // The photo stamp belongs to the photo endpoint, never to a form.
        const incoming = settleProfileSync(e as Employee, before);
        return before
          ? {
              ...incoming,
              photoVersion: before.photoVersion,
              createdAt: before.createdAt,
              updatedAt: stamp,
            }
          : { ...incoming, photoVersion: 0, createdAt: stamp, updatedAt: stamp };
      });
      const next = mergeChanges(current, { upsert, remove: parsed.data.remove });
      const seen = new Map<string, string>();
      for (const e of next) {
        const key = e.deloitteEmail.toLowerCase();
        if (seen.has(key)) {
          throw new StaffError(`${e.deloitteEmail} is already on the roster.`);
        }
        seen.set(key, e.id);
      }
      await writeCollection("employees", next, env);
      const removed = parsed.data.remove ?? [];
      await dropSchedules(removed, env);
      await removePhotos(removed, env);
      return next as Collections[K];
    }

    if (kind === "offboarded") {
      const parsed = offboardedChangesSchema.safeParse(body);
      if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
      const current = await readCollection("offboarded", env);
      const stored = new Map(current.map((e) => [e.id, e]));
      const stamp = now();
      // Only people already offboarded can be edited here; the move itself has its own endpoint.
      const upsert = (parsed.data.upsert ?? []).map((e) => {
        const before = stored.get(e.id);
        if (!before)
          throw new StaffError("That person is not in the offboarded list.", 404);
        return {
          ...(e as Employee),
          photoVersion: before.photoVersion,
          createdAt: before.createdAt,
          updatedAt: stamp,
          offboardedAt: before.offboardedAt,
        };
      });
      const next = mergeChanges(current, { upsert, remove: parsed.data.remove });
      await writeCollection("offboarded", next, env);
      const removed = new Set(parsed.data.remove ?? []);
      await removePhotos([...removed], env);
      await dropRosterEntries(
        current.filter((p) => removed.has(p.id) && !next.some((n) => n.id === p.id)),
        env,
      );
      return next as Collections[K];
    }

    const schema = kind === "shifts" ? shiftChangesSchema : timeOffChangesSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
    const upsert = (parsed.data.upsert ?? []) as (ShiftAssignment | TimeOffRequest)[];
    if (kind === "shifts") {
      const members = new Set((await readRosterConfig(env)).members.map((m) => m.id));
      if (upsert.some((item) => !members.has((item as ShiftAssignment).memberId))) {
        throw new StaffError("That person is not on the shift roster.", 404);
      }
    } else {
      const people = new Set((await readCollection("employees", env)).map((e) => e.id));
      if (upsert.some((item) => !people.has((item as TimeOffRequest).employeeId))) {
        throw new StaffError("That person is not on the roster.", 404);
      }
    }
    const current = (await readCollection(kind, env)) as (
      ShiftAssignment | TimeOffRequest
    )[];
    const next = mergeChanges<ShiftAssignment | TimeOffRequest>(current, {
      upsert,
      remove: parsed.data.remove,
    });
    await writeCollection(kind, next as Collections[K], env);
    return next as Collections[K];
  });
}

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------

/** Moves people off the roster into the offboarded list, or back. Their time off
 *  is dropped when they leave and their shift roster entry is unlinked; their
 *  profile and photo are kept.
 *  Returns both lists as saved. */
export async function moveEmployees(
  body: unknown,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<{ employees: Employee[]; offboarded: OffboardedEmployee[] }> {
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
  const { action, ids } = parsed.data;
  const wanted = new Set(ids);
  return withLock(env, async () => {
    const employees = await readCollection("employees", env);
    const offboarded = await readCollection("offboarded", env);
    const stamp = now();

    // Each list is written with the new copy before the old one is dropped, so
    // an interrupted move can duplicate a person but never lose one.
    if (action === "offboard") {
      const leaving = employees.filter((e) => wanted.has(e.id));
      if (leaving.length !== wanted.size) {
        throw new StaffError("That person is not on the roster.", 404);
      }
      const nextOffboarded = [
        ...offboarded.filter((o) => !wanted.has(o.id)),
        ...leaving.map((e) => ({ ...e, updatedAt: stamp, offboardedAt: stamp })),
      ];
      const nextEmployees = employees.filter((e) => !wanted.has(e.id));
      await writeCollection("offboarded", nextOffboarded, env);
      await writeCollection("employees", nextEmployees, env);
      await dropSchedules(ids, env);
      return { employees: nextEmployees, offboarded: nextOffboarded };
    }

    const returning = offboarded.filter((o) => wanted.has(o.id));
    if (returning.length !== wanted.size) {
      throw new StaffError("That person is not in the offboarded list.", 404);
    }
    const emails = new Set(employees.map((e) => e.deloitteEmail.toLowerCase()));
    for (const person of returning) {
      const key = person.deloitteEmail.toLowerCase();
      if (emails.has(key)) {
        throw new StaffError(`${person.deloitteEmail} is already on the roster.`);
      }
      emails.add(key);
    }
    const nextEmployees = [
      ...employees,
      ...returning.map((o) => {
        const back: Partial<OffboardedEmployee> = { ...o, updatedAt: stamp };
        delete back.offboardedAt;
        return back as Employee;
      }),
    ];
    const nextOffboarded = offboarded.filter((o) => !wanted.has(o.id));
    await writeCollection("employees", nextEmployees, env);
    await writeCollection("offboarded", nextOffboarded, env);
    return { employees: nextEmployees, offboarded: nextOffboarded };
  });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Updates a person wherever they are kept (roster or offboarded list).
 *  Returns false when they are in neither. Caller holds the lock. */
async function patchPerson(
  id: string,
  env: Env,
  patch: (person: Employee) => Employee,
): Promise<boolean> {
  const people = await readCollection("employees", env);
  const at = people.findIndex((e) => e.id === id);
  if (at >= 0) {
    people[at] = { ...people[at], ...patch(people[at]) };
    await writeCollection("employees", people, env);
    return true;
  }
  const gone = await readCollection("offboarded", env);
  const goneAt = gone.findIndex((e) => e.id === id);
  if (goneAt < 0) return false;
  gone[goneAt] = { ...gone[goneAt], ...patch(gone[goneAt]) };
  await writeCollection("offboarded", gone, env);
  return true;
}

function assertEmployeeId(id: string): void {
  if (!EMPLOYEE_ID.test(id)) throw new StaffError("Unknown employee.", 404);
}

async function writePhotoFile(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, file);
}

/** Stores the photo and stamps the employee. Caller holds the lock. */
async function savePhoto(
  id: string,
  bytes: Uint8Array,
  env: Env,
  stamp: string,
): Promise<void> {
  const checked = checkPhoto(bytes);
  if ("error" in checked) throw new StaffError(checked.error);
  const file = photoFile(id, env);
  await writePhotoFile(file, bytes);
  const found = await patchPerson(id, env, (p) => ({
    ...p,
    photoVersion: Date.now(),
    updatedAt: stamp,
  }));
  if (!found) {
    await rm(file, { force: true });
    throw new StaffError("Unknown employee.", 404);
  }
}

export function putPhoto(
  id: string,
  bytes: Uint8Array,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  assertEmployeeId(id);
  return withLock(env, () => savePhoto(id, bytes, env, now()));
}

export async function getPhoto(
  id: string,
  env: Env = process.env,
): Promise<{ bytes: Uint8Array; type: PhotoType } | null> {
  assertEmployeeId(id);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(photoFile(id, env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const type = sniffPhotoType(bytes);
  return type ? { bytes, type } : null;
}

export function deletePhoto(
  id: string,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  assertEmployeeId(id);
  return withLock(env, async () => {
    await rm(photoFile(id, env), { force: true });
    await patchPerson(id, env, (p) =>
      p.photoVersion === 0 ? p : { ...p, photoVersion: 0, updatedAt: now() },
    );
  });
}

// ---------------------------------------------------------------------------
// M365 profile (Power Automate)
// ---------------------------------------------------------------------------

/** Fills the M365-sourced fields (and the photo) of the person with this email. */
export async function applyProfileSync(
  body: unknown,
  env: Env = process.env,
  now: () => string = () => new Date().toISOString(),
): Promise<Employee> {
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) throw new StaffError(firstIssue(parsed.error));
  const profile = parsed.data;
  return withLock(env, async () => {
    const people = await readCollection("employees", env);
    const person = findByEmail(people, profile.email);
    if (!person) throw new StaffError("No one on the roster has that email.", 404);

    let photo: Uint8Array | null = null;
    if (profile.photoBase64) {
      photo = decodeBase64Photo(profile.photoBase64);
      if (!photo) throw new StaffError("The photo is not valid base64.");
      const checked = checkPhoto(photo);
      if ("error" in checked) throw new StaffError(checked.error);
    }

    const updated = applyProfile(person, profile, now());
    people[people.indexOf(person)] = updated;
    await writeCollection("employees", people, env);
    if (photo) await savePhoto(person.id, photo, env, now());
    return (
      (await readCollection("employees", env)).find((e) => e.id === person.id) ?? updated
    );
  });
}
