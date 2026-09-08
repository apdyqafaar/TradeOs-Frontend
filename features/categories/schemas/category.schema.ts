import { z } from "zod";

/**
 * MIRROR OF `Backend/src/validators/category.validation.ts`.
 *
 * Every bound below is copied from that file so the browser refuses what the
 * API would refuse. This schema is not the authority — the API validates
 * again and answers a 422 whose `errors` map `fieldErrorsFor` feeds into the
 * form. When the backend validator changes, change this file in the same
 * commit.
 *
 * `z.strictObject`, unlike `features/organization/schemas`: the backend's two
 * category schemas really are `.strict()`, so an unknown key there is a 422
 * rather than a silently stripped field. Mirroring that means a stray key is
 * caught in the browser instead of on the wire.
 */

/** 1–60 after trimming, matching `categoryName`. */
const categoryName = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(60, "Category name must be 60 characters or fewer");

/** Up to 200 after trimming, matching `categoryDescription`. */
const categoryDescription = z
  .string()
  .trim()
  .max(200, "Description must be 200 characters or fewer");

/** `POST /categories`. */
export const createCategorySchema = z.strictObject({
  name: categoryName,
  description: categoryDescription.optional(),
});

/**
 * `PATCH /categories/:id`.
 *
 * `description` is **nullable and optional, and the two mean different
 * things**: omitting the key leaves the description alone, while sending
 * `null` clears it (`Backend/src/services/category.service.ts:84-87` turns a
 * `null` into a `$unset`). A `.partial()` of the create schema would lose
 * that distinction and make an existing description impossible to remove.
 *
 * The `.refine` mirrors the backend's: `PATCH` with an empty body is a
 * validation error there, not a no-op success, so sending one would be a
 * round trip that can only fail.
 */
export const updateCategorySchema = z
  .strictObject({
    name: categoryName.optional(),
    description: categoryDescription.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
