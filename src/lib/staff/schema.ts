// Server-side validation of what the API accepts. Anything outside these shapes
// is refused before it can reach a file.
import { z } from "zod";
import { isIsoDate } from "./dates.ts";
import { EMPLOYEE_ID } from "./employees.ts";
import { TIME_OFF_ID } from "./timeoff.ts";
import { assignmentId, MEMBER_ID } from "./shifts.ts";
import { LOCATIONS, TIME_OFF_STATUSES, TIME_OFF_TYPES } from "./types.ts";

const text = (max = 200) => z.string().trim().max(max);
const optionalDate = z
  .string()
  .refine((v) => v === "" || isIsoDate(v), "Not a valid date.");
const requiredDate = z.string().refine(isIsoDate, "Not a valid date.");
const stamp = z.string().max(40);

export const employeeSchema = z.object({
  id: z.string().regex(EMPLOYEE_ID),
  firstName: text(80),
  lastName: text(80),
  deloitteEmail: text(254).pipe(z.email()),
  milestone: text(4).refine(
    (v) => v === "" || /^\d{4}$/.test(v),
    "Use a four-digit year.",
  ),
  rollOffDate: optionalDate,
  campus: z.boolean(),
  location: z.enum([...LOCATIONS, ""]),
  homeOffice: text(),
  level: text(60),
  offering: text(),
  op: text(),
  team: text(),
  phone: text(40),
  skills: z.array(text(60)).max(60),
  deloittePersonId: text(60),
  takedaEmail: text(254).refine(
    (v) => v === "" || z.email().safeParse(v).success,
    "Not an email.",
  ),
  staffitStartDate: optionalDate,
  staffitEndDate: optionalDate,
  contractEndDate: optionalDate,
  networkId: text(60),
  workdayId: text(60),
  gender: text(40),
  clientManager: text(),
  excludeFromShiftRoster: z.boolean().default(false),
  photoVersion: z.number().int().min(0),
  profileSync: z.enum(["pending", "synced", "manual"]),
  createdAt: stamp,
  updatedAt: stamp,
});

export const offboardedSchema = employeeSchema.extend({ offboardedAt: stamp });

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use letters, digits and dashes.");
/** `<scheduleId>:<shiftId>`, `status:<id>` or `custom`. */
const REF = /^(custom|[a-z0-9][a-z0-9-]{0,39}:[a-z0-9][a-z0-9-]{0,39})$/;

export const shiftSchema = z
  .object({
    id: z.string().max(80),
    memberId: z.string().regex(MEMBER_ID),
    date: requiredDate,
    ref: z.string().regex(REF),
    text: text(80).optional(),
    swap: z.boolean().optional(),
    note: text(300).optional(),
  })
  .refine((s) => s.id === assignmentId(s.memberId, s.date), "Shift id does not match.")
  .refine((s) => s.ref !== "custom" || !!s.text, "Custom hours need some text.");

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");

export const rosterConfigSchema = z
  .object({
    schedules: z
      .array(
        z.object({
          id: slug,
          name: text(60).min(1),
          shifts: z
            .array(
              z.object({
                id: slug,
                label: text(30).min(1),
                start: hhmm,
                end: hhmm,
                days: z.array(z.number().int().min(0).max(6)).max(7),
              }),
            )
            .max(40),
        }),
      )
      .max(60),
    groups: z
      .array(
        z.object({
          id: slug,
          name: text(60).min(1),
          scheduleId: slug,
          hidden: z.boolean().optional(),
        }),
      )
      .max(200),
    members: z
      .array(
        z.object({
          id: z.string().regex(MEMBER_ID),
          name: text(120).min(1),
          employeeId: z.string().regex(EMPLOYEE_ID).nullable(),
          groupId: slug,
          city: text(60),
          role: text(80),
        }),
      )
      .max(2000),
    events: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9_.|-]{1,80}$/),
          date: requiredDate,
          endDate: requiredDate,
          label: text(100).min(1),
          kind: z.enum(["holiday", "swap", "note"]),
          locations: z.array(text(60).min(1)).max(40).optional(),
        }),
      )
      .max(2000),
  })
  .superRefine((config, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const unique = (ids: string[], what: string) => {
      if (new Set(ids).size !== ids.length) fail(`Two ${what} share an id.`);
    };
    unique(
      config.schedules.map((s) => s.id),
      "schedules",
    );
    if (config.schedules.some((s) => s.id === "status" || s.id === "custom")) {
      fail("A schedule cannot be called status or custom.");
    }
    unique(
      config.groups.map((g) => g.id),
      "teams",
    );
    unique(
      config.members.map((m) => m.id),
      "people",
    );
    unique(
      config.events.map((e) => e.id),
      "events",
    );
    for (const s of config.schedules) {
      unique(
        s.shifts.map((x) => x.id),
        `shifts in ${s.name}`,
      );
    }
    const schedules = new Set(config.schedules.map((s) => s.id));
    const groups = new Set(config.groups.map((g) => g.id));
    if (config.groups.some((g) => !schedules.has(g.scheduleId))) {
      fail("A team uses a schedule that does not exist.");
    }
    if (config.members.some((m) => !groups.has(m.groupId))) {
      fail("A person is in a team that does not exist.");
    }
    const linked = config.members
      .map((m) => m.employeeId)
      .filter((id): id is string => !!id);
    unique(linked, "people linked to the same profile");
    if (config.events.some((e) => e.endDate < e.date))
      fail("An event ends before it starts.");
  });

/** Replace the roster configuration and merge in assignments (the workbook import). */
export const rosterImportSchema = z.object({
  config: rosterConfigSchema,
  upsert: z.array(shiftSchema).max(40000).optional(),
});

export const timeOffSchema = z
  .object({
    id: z.string().regex(TIME_OFF_ID),
    employeeId: z.string().regex(EMPLOYEE_ID),
    type: z.enum(TIME_OFF_TYPES),
    startDate: requiredDate,
    endDate: requiredDate,
    reason: text(500),
    status: z.enum(TIME_OFF_STATUSES),
    createdAt: stamp,
    decidedAt: stamp,
  })
  .refine((r) => r.endDate >= r.startDate, "The end date is before the start date.");

const changes = <T extends z.ZodType>(item: T, max = 2000) =>
  z.object({
    upsert: z.array(item).max(max).optional(),
    remove: z.array(z.string().max(80)).max(max).optional(),
  });

export const employeeChangesSchema = changes(employeeSchema);
export const offboardedChangesSchema = changes(offboardedSchema);
export const shiftChangesSchema = changes(shiftSchema, 20000);
export const timeOffChangesSchema = changes(timeOffSchema);

const optionalText = (max = 200) => z.string().trim().max(max).optional();

/** Which people to move between the roster and the offboarded list. */
export const moveSchema = z.object({
  action: z.enum(["offboard", "restore"]),
  ids: z.array(z.string().regex(EMPLOYEE_ID)).min(1).max(2000),
});

/** What the M365 profile flow posts. */
export const profileSchema = z.object({
  email: text(254).pipe(z.email()),
  firstName: optionalText(80),
  lastName: optionalText(80),
  homeOffice: optionalText(),
  level: optionalText(60),
  op: optionalText(),
  phone: optionalText(40),
  photoBase64: z.string().max(1_500_000).optional(),
});
