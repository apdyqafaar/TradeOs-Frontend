import { z } from "zod";
import type { Announcement } from "../types";

/**
 * MIRROR OF `../Backend/src/validators/announcement.validation.ts`.
 *
 * Every bound below is copied from that file and cross-checked against the
 * verified contract, `docs/contracts/projects-announcements.md` §2.2–§2.3. This
 * schema is not the authority — the API validates again and answers a 422 whose
 * `errors` map `fieldErrorsFor` feeds back onto the form. When the backend
 * validator changes, change this file in the same commit.
 *
 * `strictObject` throughout, matching both bodies being `.strict()`: an unknown
 * key is a 422 there, so it is a parse failure here rather than a silently
 * dropped field.
 */

/** Every id in this API is a MongoDB ObjectId — 24 hex characters, case-insensitive. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

/**
 * The shared shape, **deliberately carrying no `.default()`**.
 *
 * This is the load-bearing half of a defect the contract verified empirically
 * rather than trusted (§1.3): in this zod version `.partial()` does **not**
 * suppress a `.default()`, so
 *
 * ```
 * z.object({ pinned: z.boolean().default(false) }).partial().safeParse({})
 *   -> OK { pinned: false }
 * ```
 *
 * If `pinned`'s default lived here instead of on the create schema below, an
 * empty PATCH would parse clean and silently **unpin** the announcement. The
 * backend keeps the default off the shared shape for exactly that reason
 * (`announcement.validation.ts:7-20,30`) and this file mirrors the arrangement,
 * not just the field list. Do not "tidy" the default up into `announcementFields`.
 */
const announcementFields = {
  /** `.trim()` then `.min(1)`, so a title of spaces is a 422, not an empty title. */
  title: z
    .string({ error: "A title is required" })
    .trim()
    .min(1, "A title is required")
    .max(150, "Keep the title to 150 characters or fewer"),
  /**
   * `.min(1)` — **unlike `project.description`**, which is optional and may be
   * empty. An announcement with no body is not a thing this API stores.
   */
  body: z
    .string({ error: "Write something to announce" })
    .trim()
    .min(1, "Write something to announce")
    .max(5000, "Keep the announcement to 5000 characters or fewer"),
  pinned: z.boolean(),
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
   * the transaction commits (`attachments.service.ts:90-98`), proven by
   * `attach.test.ts:268-302`. There is no "recently removed" gallery to restore
   * from, so a screen that clears a cover is destroying an image, not
   * unlinking one.
   *
   * On **create** a `null` here is accepted and silently ignored — the service
   * guards with `if (input.coverUploadId)` (`announcement.service.ts:83`).
   */
  coverUploadId: objectId.nullable(),
} as const;

/**
 * `POST /announcements` — `announcements:create`. 201 with the created row.
 *
 * `pinned` is re-declared with its default here, on top of the un-defaulted
 * shape, which is the arrangement the note on `announcementFields` explains.
 * It is **the only `.default()` in the whole announcement validator**
 * (contract §2.2), so a create body needs nothing but `title` and `body`:
 * `createAnnouncementSchema.parse({ title: "T", body: "B" })` is
 * `{ title: "T", body: "B", pinned: false }`, verified against the real schema.
 */
export const createAnnouncementSchema = z.strictObject({
  ...announcementFields,
  pinned: z.boolean().default(false),
  coverUploadId: announcementFields.coverUploadId.optional(),
});

export type CreateAnnouncementInput = z.input<typeof createAnnouncementSchema>;
/** What the API actually receives — `pinned` resolved by the default. */
export type CreateAnnouncementBody = z.output<typeof createAnnouncementSchema>;

/**
 * `PATCH /announcements/:id` — `announcements:update`. 200 with the updated row.
 *
 * **`PATCH {}` is a 422, deliberately, and not a no-op 200** (contract §2.3,
 * trap 5; live guard `announcements.test.ts:209-222`). The object-level
 * `.refine` has an empty zod path, and `zodToFieldErrors` keys an empty path
 * as **`"_"`** (`error.middleware.ts:12`), so the message
 * `"At least one field must be provided"` arrives under a field name no form
 * has a control for. A dirty-field form that posts `{}` when nothing changed
 * surfaces that to the user as a mystery — which is what `announcementPatch`
 * below exists to make impossible.
 *
 * The refine is mirrored here so the browser gives the same answer the server
 * would, one round trip earlier.
 */
export const updateAnnouncementSchema = z
  .strictObject(announcementFields)
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one field must be provided",
  });

export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

/**
 * The key a body-level refusal arrives under on a 422 — an object-level zod
 * issue has an empty path, and `zodToFieldErrors` names it `"_"`.
 *
 * Exported so a form can route it to its form-level slot instead of hunting for
 * a control called `_` and dropping the message on the floor.
 */
export const FORM_LEVEL_ERROR_KEY = "_";

/**
 * The **only** correct way to build a PATCH body in this slice.
 *
 * Three rules, and every one of them has already cost somebody a bug somewhere
 * in this repo or is called out as a trap in the contract:
 *
 *   1. **Send only what changed.** `PATCH` is a `$set`, proven on the wire
 *      (`announcements.test.ts:118-127`: patching `{title, pinned}` leaves
 *      `createdBy` intact), so resending unchanged fields is not harmful — but
 *      resending `coverUploadId` unchanged makes a no-op edit re-run the
 *      attachment path, and an edit that touches nothing must not be sent at
 *      all.
 *   2. **`pinned: false` is a real value, not an absence.** `false` is not
 *      `undefined`; unpinning is a legitimate one-field PATCH. A truthiness
 *      filter over the diff — `if (next.pinned)` — drops exactly the update the
 *      Unpin button exists to make, which is the failure mode this function is
 *      written to prevent.
 *   3. **`coverUploadId: null` is a real value too**, and means *delete the
 *      image*. It is distinguished from "leave it alone" by `null` vs
 *      `undefined` in `resolveCover` (`announcement.service.ts:36-42`), so the
 *      key must be present-and-null, never dropped.
 *
 * Returns `null` when nothing changed, which is the caller's cue to close the
 * form rather than post an empty body and read back a 422 keyed `"_"`.
 *
 * `next.coverUploadId` is compared against `original.cover?.uploadId ?? null`
 * because the two sides speak different shapes: the wire answers a whole
 * `cover` object and takes back a bare id.
 */
export function announcementPatch(
  original: Announcement,
  next: {
    title: string;
    body: string;
    pinned: boolean;
    coverUploadId: string | null;
  },
): UpdateAnnouncementInput | null {
  const patch: UpdateAnnouncementInput = {};

  // The API trims before comparing, so trim before deciding, or a title that
  // gained a trailing space reads as changed and posts an identical value.
  const title = next.title.trim();
  const body = next.body.trim();

  if (title !== original.title) patch.title = title;
  if (body !== original.body) patch.body = body;
  // `!==` on booleans, never truthiness: `false !== true` is the unpin.
  if (next.pinned !== original.pinned) patch.pinned = next.pinned;

  const currentCover = original.cover?.uploadId ?? null;
  if (next.coverUploadId !== currentCover) {
    // Present and `null` when the cover is being removed. Dropping the key
    // would mean "keep it" and the image would stay.
    patch.coverUploadId = next.coverUploadId;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
