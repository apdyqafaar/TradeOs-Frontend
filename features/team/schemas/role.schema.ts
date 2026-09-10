import { z } from "zod";
import { ALL_PERMISSIONS, WILDCARD } from "@/lib/auth/permissions";

/**
 * Client mirror of `Backend/src/validators/role.validation.ts`.
 *
 * Four rules here are load-bearing and each one has already been guessed wrong
 * by somebody, so they are spelled out rather than implied:
 *
 * 1. **`permissions` is REQUIRED on create.** The *model* defaults it to `[]`;
 *    the *schema* does not (`role.validation.ts:28` — no `.default()`).
 *    Omitting the key is a 422 reading `"expected array, received undefined"`,
 *    not an empty role. Send `permissions: []` explicitly for a role that can
 *    do nothing — that is legal and accepted.
 * 2. **The array is capped at 43**, the size of the whole catalog.
 * 3. **The array is NOT de-duplicated server-side.** `["members:view",
 *    "members:view", "members:view"]` is accepted as sent. A UI that appends on
 *    every checkbox click hits `"Too big: expected array to have <=43 items"`
 *    long before the user has picked 43 distinct permissions, so `permissionSet`
 *    below de-dupes on the way out and this schema refuses duplicates on the way
 *    in.
 * 4. **The wildcard cannot be granted.** `"*"` belongs to the Owner preset
 *    alone; sending it is a 422 on `permissions.0`
 *    (`role.validation.ts:17`, `roles.test.ts:152-161`).
 */

const MAX_PERMISSIONS = ALL_PERMISSIONS.length; // 43, and the backend's cap.

const CATALOG = new Set<string>(ALL_PERMISSIONS);

/**
 * `permissionList`, `role.validation.ts:13-20`, plus a duplicate check the
 * backend does not have. The extra strictness is safe in one direction only:
 * everything this refuses, the backend would either refuse too or accept as a
 * silently over-long array. Nothing legal is blocked.
 */
export const permissionListSchema = z
  .array(
    z
      .string()
      .refine(
        (v) => v !== WILDCARD,
        "The wildcard permission cannot be granted",
      )
      .refine((v) => CATALOG.has(v), "Unknown permission — not in the catalog"),
  )
  .max(
    MAX_PERMISSIONS,
    `A role can hold at most ${MAX_PERMISSIONS} permissions`,
  )
  .refine(
    (list) => new Set(list).size === list.length,
    "The same permission was listed twice",
  );

/**
 * De-duplicate and put the catalog's own order back, so two roles built by
 * clicking the same boxes in a different order send byte-identical bodies.
 * Call this on every submit — see rule 3 above.
 */
export const permissionSet = (selected: Iterable<string>): string[] => {
  const chosen = new Set(selected);
  return ALL_PERMISSIONS.filter((permission) => chosen.has(permission));
};

/**
 * The three names a custom role may not take, in any casing and after
 * trimming — `isReservedRoleName`, `role.validation.ts:23,48-49`. The server
 * answers 409 `"\"<name>\" is a built-in role name"`; catching it here saves
 * the round trip and puts the message on the field instead of the form.
 *
 * `"Ownerly"` is fine. Only an exact match after trim and case-fold is reserved.
 */
const RESERVED = new Set(["owner", "manager", "seller"]);

export const isReservedRoleName = (name: string): boolean =>
  RESERVED.has(name.trim().toLowerCase());

const roleName = z
  .string()
  .trim()
  .min(1, "Role name is required")
  .max(60, "Role name cannot be more than 60 characters")
  .refine((name) => !isReservedRoleName(name), {
    message: "That is a built-in role name — pick another",
  });

const roleDescription = z
  .string()
  .trim()
  .max(200, "Description cannot be more than 200 characters");

/** `POST /roles` — `role.validation.ts:25-29`. 201 with the created role. */
export const createRoleSchema = z.object({
  name: roleName,
  description: roleDescription.optional(),
  permissions: permissionListSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * `PATCH /roles/:id` — `role.validation.ts:31-39`.
 *
 * Every field optional, with a refine demanding at least one. It is **not**
 * `createRoleSchema.partial()`, and the difference is not cosmetic: in zod 4 a
 * `.default()` survives `.partial()`, so a partial built that way would write
 * the default over a stored value on any PATCH that omitted the field. The
 * backend hand-wrote three `.optional()`s to avoid exactly that; this mirror
 * does the same rather than reaching for `.partial()`.
 *
 * The server's empty-body 422 arrives under the field key **`_`**, not under a
 * real field name (`error.middleware.ts:12`), so a form that maps `errors` onto
 * inputs shows nothing for it. This schema refuses it before it is sent.
 */
export const updateRoleSchema = z
  .object({
    name: roleName.optional(),
    description: roleDescription.optional(),
    permissions: permissionListSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Change something first",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
