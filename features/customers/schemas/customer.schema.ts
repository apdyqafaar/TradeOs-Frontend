import { z } from "zod";
import { API_ERROR_CODE } from "@/lib/api/errors";

/**
 * MIRROR OF `../Backend/src/validators/customer.validation.ts`.
 *
 * Every bound below is copied from that file. This schema is not the
 * authority — the API validates again and answers a 422 whose `errors` map
 * `fieldErrorsFor` feeds into `setError`. When the backend validator changes,
 * change this file in the same commit.
 *
 * `strictObject`, matching the backend's `.strict()`: an unknown key is a 422
 * there, so it is a parse failure here rather than a silently dropped field.
 */

/**
 * The one required field besides the name.
 *
 * The regex is the backend's, character for character. It is deliberately
 * permissive about *formatting* and strict about *content*: the numbers people
 * type in this market look like `+252 61 234 5678` and `0712-345-678`, and a
 * validator that insisted on E.164 would reject both. Letters are the thing it
 * refuses.
 *
 * What it does not do is normalise. `normalizePhone`
 * (`../Backend/src/db/actions/customer.actions.ts:25`) strips spaces, dashes,
 * parentheses and dots server-side before the uniqueness index sees the value,
 * so `+252 61 234 5678` is **stored and returned** as `+252612345678`. Nothing
 * on this side should reproduce that: it is the server's normalisation, and a
 * second copy of it here would be a rule to keep in sync for no gain.
 */
const phone = z
  .string()
  .trim()
  .min(5, "Enter a phone number of at least 5 digits")
  .max(32, "That phone number is too long")
  .regex(
    /^\+?[\d\s\-().]+$/,
    "A phone number can only hold digits, spaces, dashes, brackets and a leading +",
  );

/**
 * `email`, optional, and blank-tolerant — which the backend's rule is not.
 *
 * The backend is `z.string().trim().toLowerCase().email().max(254).optional()`.
 * Mirrored literally, that rejects `""`, and `""` is exactly what an untouched
 * optional `<input>` submits: the sheet in Task 8 would 422 on a field the
 * user never filled in. So a blank (or whitespace-only) value parses to
 * `undefined` here, and `JSON.stringify` drops the key from the request body —
 * the API sees an omitted field, which is what "no email" means to it.
 *
 * The consequence to know: because the API refuses `""` and this maps it to
 * "leave it alone", **an email that has been set cannot be cleared** through
 * `PATCH /customers/:id`. That is a backend limitation, not a choice made
 * here; see `docs/findings/s2-task-03.md`.
 *
 * Trimming happens before the format check, so a pasted `" sales@x.co "` is
 * accepted rather than reported as malformed. Lower-casing matches the model's
 * `lowercase: true`, so the value the form holds is the value the API stores.
 */
const optionalEmail = z
  .string()
  .trim()
  .pipe(
    z.union([
      z.literal(""),
      z.email("Enter a valid email address").toLowerCase().max(254),
    ]),
  )
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * `POST /customers`
 *
 * `status` is not here and must not be: it is server-set (`default: "active"`)
 * and a strict body would 422 on it.
 */
export const createCustomerSchema = z.strictObject({
  name: z.string().trim().min(1, "A customer needs a name").max(120),
  phone,
  email: optionalEmail,
  /**
   * `address` and `notes` accept `""` where `email` does not, and the
   * asymmetry is the backend's: both are bounded but have no `min`, so `""` is
   * a value the API stores. On a PATCH that is the only way to *clear* one, so
   * collapsing it to `undefined` the way `email` does would make the field
   * un-emptiable.
   */
  address: z.string().trim().max(300, "That address is too long").optional(),
  notes: z.string().trim().max(2000, "That note is too long").optional(),
});

/**
 * `PATCH /customers/:id`
 *
 * Derived from create so a new field cannot be forgotten here, plus the one
 * field the backend's update schema adds. `.partial()` and `.extend()` both
 * preserve strictness (verified against zod 4.5.4).
 *
 * `status` is `"active"` and only `"active"`: PATCH can *restore* an archived
 * customer, but it cannot archive one — that is `DELETE /customers/:id`, which
 * runs the open-debt check first. A form offering "archived" here would send a
 * value the API answers 422 to.
 *
 * The final refinement mirrors the backend's `"Nothing to update"`: an empty
 * body is a 422, so a sheet whose user changed nothing is caught in the
 * browser instead of on the wire.
 */
export const updateCustomerSchema = createCustomerSchema
  .partial()
  .extend({ status: z.literal("active").optional() })
  .refine((values) => Object.keys(values).length > 0, {
    message: "Nothing has changed",
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/**
 * The 409 this resource raises on a write, and the field that caused it.
 *
 * Feeds the `CONFLICT_FIELDS` slot in the form template: a duplicate phone is
 * not a banner. The caller typed a number that another customer already holds,
 * and the only thing they can do about it is change that box — so the message
 * belongs against that box, where they are already looking. Keyed by `code`,
 * never by `message`.
 *
 * `DUPLICATE_PHONE` is raised on both create and update, and it can fire even
 * on a number the form has never seen: the index is
 * `{ organizationId, phone }` over the **normalised** value, so `0712 345 678`
 * collides with an existing `0712-345-678`
 * (`../Backend/src/services/customer.service.ts:56-60, 88-93`).
 *
 * `CUSTOMER_HAS_OPEN_DEBT` is deliberately absent. It is refused by
 * `DELETE /customers/:id` and belongs inline on the Archive button — there is
 * no field the user could edit to fix it.
 */
export const CUSTOMER_CONFLICT_FIELDS = {
  [API_ERROR_CODE.DUPLICATE_PHONE]: "phone",
} as const satisfies Partial<Record<string, keyof CreateCustomerInput>>;
