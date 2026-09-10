import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import type { Project, ProjectStatus } from "../types";
import { PROJECT_STATUSES } from "../types";

/**
 * MIRROR OF `../Backend/src/validators/project.validation.ts`.
 *
 * Every bound below is copied from that file and cross-checked against the
 * verified contract, `docs/contracts/projects-announcements.md` §1.2–§1.4.
 * This schema is not the authority — the API validates again and answers a 422
 * whose `errors` map `fieldErrorsFor` feeds back onto the form. When the
 * backend validator changes, change this file in the same commit.
 *
 * `strictObject` throughout, matching every body being `.strict()`: an unknown
 * key is a 422 there, so it is a parse failure here rather than a silently
 * dropped field.
 */

/** Every id in this API is a MongoDB ObjectId — 24 hex characters, case-insensitive. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

/**
 * A full ISO datetime ending in `Z`, which is the only date format these two
 * routes accept.
 *
 * `z.string().datetime()` in the backend's zod 4.4.3 defaults to
 * `offset: false`, so — verified against the real schema (contract §1.2):
 *
 * ```
 * startDate: "2026-01-01"                -> FAIL  Invalid ISO datetime
 * startDate: "2026-01-01T00:00:00+02:00" -> FAIL  Invalid ISO datetime
 * startDate: "2026-01-01T00:00:00.000Z"  -> OK
 * ```
 *
 * The offset form is the dangerous one, because it is what a timezone-aware
 * date library hands you by default — see `dateInputToIso` below.
 */
const isoInstant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "Needs a full date and time ending in Z",
  );

/**
 * The shared shape, **deliberately carrying no `.default()`**.
 *
 * This is the load-bearing half of a defect the contract verified empirically
 * rather than trusted (§1.3): in this zod version `.partial()` does **not**
 * suppress a `.default()`, so
 *
 * ```
 * z.object({ progress: z.number().default(0) }).partial().safeParse({})
 *   -> OK { progress: 0 }
 * ```
 *
 * If `status` and `progress` carried their defaults here instead of on the
 * create schema below, an empty PATCH would parse clean and silently **reset a
 * project to "planned" at 0%**. The backend keeps the defaults off the shared
 * shape for exactly that reason (`project.validation.ts:23-33,38-39`) and this
 * file mirrors the arrangement, not just the field list. Do not "tidy" the
 * defaults up into `projectFields`.
 */
const projectFields = {
  /** `.trim()` then `.min(1)`, so a title of spaces is a 422, not an empty title. */
  title: z
    .string({ error: "A project needs a title" })
    .trim()
    .min(1, "A project needs a title")
    .max(150, "Keep the title to 150 characters or fewer"),
  /**
   * **No `.min()`** — unlike `announcement.body`, an empty description parses.
   * It is also the only way to "clear" one: `description: null` is a 422, and
   * `""` round-trips as `""` rather than as `null` (contract §1.3), so a screen
   * must test for emptiness rather than for null.
   */
  description: z
    .string()
    .trim()
    .max(5000, "Keep the description to 5000 characters or fewer"),
  /**
   * A customer id. **Not nullable** — `customerId: null` is a 422, so once a
   * project has a customer there is no way to detach it through this API
   * (contract §1.3, trap 5). An unknown or cross-tenant id is a **404
   * `Customer not found`**, not a 422 (`project.service.ts:35-41`, proven
   * `projects.test.ts:78-96`).
   */
  customerId: objectId,
  status: z.enum(PROJECT_STATUSES, { error: "Pick a status" }),
  /**
   * Integer 0..100. `.int()` matters: `progress: 100.5` is a 422, and a slider
   * or a percentage typed with a decimal will produce one.
   */
  progress: z
    .number({ error: "Progress is a number from 0 to 100" })
    .int("Progress is a whole number")
    .min(0, "Progress cannot be below 0")
    .max(100, "Progress cannot be above 100"),
  /** Not nullable — a start date, once set, cannot be cleared (contract §1.3). */
  startDate: isoInstant,
  /** Not nullable either. Same one-way door as `startDate`. */
  dueDate: isoInstant,
  /**
   * Nullable **and** optional, and the three states are three different
   * instructions to the server (contract §6.2):
   *
   * | value     | meaning                                                   |
   * |-----------|-----------------------------------------------------------|
   * | omitted   | leave the cover exactly as it is                           |
   * | an id     | attach it; drop and **permanently delete** the old one     |
   * | `null`    | detach and **permanently delete** the current cover        |
   *
   * The delete is real: `releaseUploads` removes the S3 object and the row once
   * the transaction commits (`attachments.service.ts:90-98`, proven by
   * `attach.test.ts:268-302`). There is no "recently removed" gallery to
   * restore from.
   *
   * The upload's `purpose` must be **`"project"`** (`project.service.ts:67`); an
   * `"announcement"` upload is a 409 `UPLOAD_PURPOSE_MISMATCH`.
   *
   * On **create** a `null` here is accepted and silently ignored — the service
   * guards with `if (input.coverUploadId)` (`project.service.ts:110`).
   */
  coverUploadId: objectId.nullable(),
} as const;

/**
 * `POST /projects` — `projects:create`. 201 with the created row.
 *
 * `status` and `progress` are re-declared with their defaults here, on top of
 * the un-defaulted shape, which is the arrangement the note on `projectFields`
 * explains. Together with `page`/`limit` they are **all four `.default()`s in
 * the projects feature** (contract §1.2), so a create body needs nothing but a
 * title: `createProjectSchema.parse({ title: "T" })` is
 * `{ title: "T", status: "planned", progress: 0 }`, verified against the real
 * schema.
 */
export const createProjectSchema = z.strictObject({
  ...projectFields,
  status: z.enum(PROJECT_STATUSES).default("planned"),
  progress: projectFields.progress.default(0),
  description: projectFields.description.optional(),
  customerId: projectFields.customerId.optional(),
  startDate: projectFields.startDate.optional(),
  dueDate: projectFields.dueDate.optional(),
  coverUploadId: projectFields.coverUploadId.optional(),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
/** What the API actually receives — `status`/`progress` resolved by the defaults. */
export type CreateProjectBody = z.output<typeof createProjectSchema>;

/**
 * `PATCH /projects/:id` — `projects:update`. 200 with the updated row.
 *
 * **`PATCH {}` is a 422, deliberately, and not a no-op 200** (contract §1.3,
 * trap 5; live guard `projects.test.ts:276-287`). The object-level `.refine`
 * has an empty zod path, and `zodToFieldErrors` keys an empty path as **`"_"`**
 * (`error.middleware.ts:12`), so the message `"At least one field must be
 * provided"` arrives under a field name no form has a control for. A
 * dirty-field form that posts `{}` when nothing changed surfaces that to the
 * user as a mystery — which is what `projectPatch` below exists to make
 * impossible.
 *
 * `isPublished`, `publishedAt` and `shareTokenHash` are **not** in this shape
 * and are `.strict()`-rejected by the server: the only writer is
 * `setProjectPublishState`, reached through the three publish routes
 * (`project.actions.ts:114-124`).
 */
export const updateProjectSchema = z
  .strictObject(projectFields)
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field must be provided",
  });

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * `POST /projects/:id/updates` — **`projects:update`, not `projects:create`**
 * (`project.route.ts:92-94`). Posting a progress note is modelled as a write on
 * the project, and so is deleting one.
 *
 * `progress` has **no default and is not nullable**: `progress: null` is a 422
 * (`expected number, received null`), so omit the key rather than sending null
 * when a note carries no progress.
 */
export const createProjectUpdateSchema = z.strictObject({
  body: z
    .string({ error: "Write what changed" })
    .trim()
    .min(1, "Write what changed")
    .max(5000, "Keep the update to 5000 characters or fewer"),
  progress: projectFields.progress.optional(),
});

export type CreateProjectUpdateInput = z.infer<
  typeof createProjectUpdateSchema
>;

/**
 * The key a body-level refusal arrives under on a 422 — an object-level zod
 * issue has an empty path, and `zodToFieldErrors` names it `"_"`.
 *
 * Exported so a form can route it to its form-level slot instead of hunting for
 * a control called `_` and dropping the message on the floor.
 */
export const FORM_LEVEL_ERROR_KEY = "_";

/**
 * A `<input type="date">` value (`"2026-01-01"`) as the instant the API wants.
 *
 * Two things make this more than a string concat, and both have teeth:
 *
 *   1. **The day must be resolved in the business's timezone**, not the
 *      browser's. A shop in Nairobi picking 1 January means midnight in
 *      Nairobi; building the instant from the reader's zone puts the stored
 *      date on 31 December for anyone west of it, and the value comes back
 *      through `formatDate(iso, timezone)` showing the wrong day.
 *   2. **The result must end in `Z`, never in an offset.** `TZDate` is the
 *      right tool for (1), but `TZDate.prototype.toISOString()` is overridden
 *      to emit the *offset* form — `…T00:00:00.000+03:00`
 *      (`node_modules/@date-fns/tz/date/index.js:14-17`) — and the backend's
 *      `z.string().datetime()` runs with `offset: false`, so that exact string
 *      is a 422. Reading the epoch back through a plain `Date` is what produces
 *      the `Z` form the validator accepts.
 *
 * Returns `undefined` for an empty or unparseable input, which is the caller's
 * cue to omit the key entirely — there is no `null` to send.
 */
export function dateInputToIso(
  value: string,
  timeZone: string,
): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const [, year, month, day] = match;
  const zoned = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    timeZone,
  );
  const epoch = zoned.getTime();
  if (Number.isNaN(epoch)) return undefined;

  // NOT `zoned.toISOString()` — see (2) above.
  return new Date(epoch).toISOString();
}

/**
 * The inverse, for populating a `<input type="date">` from a stored instant.
 *
 * Same zone rule: the day shown in the form is the business's day, so that
 * opening an edit form and saving it without touching the date cannot move it.
 * `Intl` rather than `date-fns` `format` because the shape wanted here is the
 * input element's own `yyyy-MM-dd`, and `en-CA` is the locale that produces it
 * natively.
 */
export function isoToDateInput(value: string | null, timeZone: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // An unresolvable zone throws a RangeError. The form losing a date is
    // better than the edit sheet failing to render.
    return "";
  }
}

/** What the edit form holds. Dates are already ISO instants by this point. */
export interface ProjectFormValues {
  title: string;
  description: string;
  customerId: string;
  status: ProjectStatus;
  progress: number;
  startDate: string | undefined;
  dueDate: string | undefined;
  coverUploadId: string | null;
}

/**
 * The **only** correct way to build a PATCH body in this slice.
 *
 * Four rules, every one of them a trap the contract names explicitly:
 *
 *   1. **Send only what changed.** `PATCH` is a `$set` and omitted keys are not
 *      written (`project.service.ts:166-172`; mongoose strips `undefined`
 *      paths), but an edit that touches nothing must not be sent at all.
 *   2. **`progress: 0` is a real value, not an absence.** A truthiness filter
 *      over the diff — `if (next.progress)` — drops exactly the edit that resets
 *      a project to 0%, which is the failure mode this function is written to
 *      prevent. Same for `status`, whose first enum member is falsy in no
 *      language but is easy to treat as a default.
 *   3. **`coverUploadId: null` is a real value too**, and means *delete the
 *      image*. It is distinguished from "leave it alone" by `null` vs
 *      `undefined` in `resolveCover` (`project.service.ts:57-63`), so the key
 *      must be present-and-null, never dropped.
 *   4. **`description`, `customerId`, `startDate` and `dueDate` cannot be
 *      cleared.** `null` is a 422 on all four. So a form that empties the start
 *      date simply omits it — the stored value stays — and the only field with
 *      a usable "empty" is `description`, as `""`. This function never emits a
 *      `null` for any of them, which is why the "cleared" case silently does
 *      nothing rather than 422-ing: the screen says so instead
 *      (`project-form-sheet.tsx`).
 *
 * Returns `null` when nothing changed, which is the caller's cue to close the
 * form rather than post an empty body and read back a 422 keyed `"_"`.
 */
export function projectPatch(
  original: Project,
  next: ProjectFormValues,
): UpdateProjectInput | null {
  const patch: UpdateProjectInput = {};

  // The API trims before comparing, so trim before deciding, or a title that
  // gained a trailing space reads as changed and posts an identical value.
  const title = next.title.trim();
  const description = next.description.trim();

  if (title !== original.title) patch.title = title;
  // `?? ""` on the original: the wire can answer `null` OR `""` for a
  // description, and both mean "there isn't one" to a form.
  if (description !== (original.description ?? "")) {
    patch.description = description;
  }
  // Never `!==` alone here: an empty `customerId` means "the form has no
  // customer", and sending `""` is a 422 while sending `null` is also a 422.
  // Only a real, changed id is sent.
  if (next.customerId && next.customerId !== original.customerId) {
    patch.customerId = next.customerId;
  }
  if (next.status !== original.status) patch.status = next.status;
  // `!==` on numbers, never truthiness: `0 !== 40` is the reset.
  if (next.progress !== original.progress) patch.progress = next.progress;

  // Dates compare as instants, not as strings: `"2026-01-01T00:00:00.000Z"`
  // and `"2026-01-01T00:00:00Z"` are the same moment and a string comparison
  // would post a no-op change every time the form opened.
  if (next.startDate && !sameInstant(next.startDate, original.startDate)) {
    patch.startDate = next.startDate;
  }
  if (next.dueDate && !sameInstant(next.dueDate, original.dueDate)) {
    patch.dueDate = next.dueDate;
  }

  const currentCover = original.cover?.uploadId ?? null;
  if (next.coverUploadId !== currentCover) {
    // Present and `null` when the cover is being removed. Dropping the key
    // would mean "keep it" and the image would stay.
    patch.coverUploadId = next.coverUploadId;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

/** Two ISO strings pointing at the same moment. `null` is never equal to one. */
function sameInstant(a: string, b: string | null): boolean {
  if (!b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  return !Number.isNaN(left) && left === right;
}
