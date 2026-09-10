import { z } from "zod";

/**
 * Client mirrors of `Backend/src/validators/member.validation.ts`.
 *
 * These exist to catch a bad value before it costs a round trip, not to be the
 * rule — the API is. Where the backend is laxer than this file (it strips
 * unknown keys on both of these bodies rather than rejecting them), the
 * difference is deliberate: nothing here ever *sends* an unknown key.
 */

/**
 * `/^[0-9a-fA-F]{24}$/` — `common.validation.ts:5-7`. A malformed id is a 422
 * from the params schema, never a 500 from a Mongoose cast
 * (`roles.test.ts:401-411`), but there is no reason to spend the request.
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "That does not look like a valid id");

/**
 * `POST /members/invite` — `member.validation.ts:4-7`. Both fields required.
 *
 * `.toLowerCase()` mirrors the backend schema, which lowercases the address
 * before anything else touches it (`invite.test.ts:98-122`). Doing it here too
 * means the self-invite comparison the client can make — "is this my own
 * address?" — matches the one the server makes, which is also case-insensitive
 * (`invite-guards.test.ts:154-168`).
 */
export const inviteMemberSchema = z.object({
  email: z.email("Enter a valid email address").toLowerCase(),
  roleId: objectIdSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * `PATCH /members/:id` — `member.validation.ts:11-13`.
 *
 * **One field, and it is required.** There is no `.partial()` and no
 * `.default()` on the backend schema; `{}` is a 422, not a no-op
 * (`manage.test.ts:383`). This endpoint changes only the role — a member's
 * name, email and status cannot be edited through it at all.
 */
export const changeMemberRoleSchema = z.object({
  roleId: objectIdSchema,
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
