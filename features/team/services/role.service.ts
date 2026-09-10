import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";
import type { ObjectId } from "@/lib/api/types";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema";
import type { Role } from "../types";

/**
 * The four `/roles` endpoints.
 *
 * Two shape facts separate this file from every other list service in the repo,
 * and both are easy to get wrong by pattern-matching:
 *
 * 1. **`GET /roles` is not paginated and has no `meta` key at all.** It answers
 *    a bare array. `successResponse` omits `meta` when undefined
 *    (`responses.ts:42`), so `apiGetList` would synthesise a fake page — use
 *    `apiGet<Role[]>`.
 * 2. **`DELETE /roles/:id` hard-deletes and answers no `data` key**, just
 *    `{ success, message }` at 200 (not 204). Its sibling
 *    `DELETE /members/:id` deactivates and answers a full body. The same verb
 *    on two adjacent routes does opposite things, so this slice deliberately
 *    has two delete functions with different return types rather than one
 *    generic handler.
 */

const BASE = "/roles";

/**
 * `GET /roles` — `roles:view`. 200 with an array.
 *
 * Returns **the three global presets plus this organization's own custom
 * roles**, never another tenant's (`role.actions.ts:7-8`). Sorted `isCustom`
 * ascending then name, so presets come first — Manager, Owner, Seller — and
 * custom roles follow alphabetically.
 *
 * **The Owner preset is in this list and cannot be assigned to anybody.**
 * It arrives with `isPreset: true` and `permissions: ["*"]`, and choosing it in
 * an invite or a role change is a 403, not a 422 (`member.service.ts:43-45`).
 * Filter it out of every picker — `assignableRoles` below is that filter.
 *
 * No query parameters exist. The route validates `body: noBodySchema` and
 * nothing else, so a GET carrying anything is a 422.
 */
export const list = (): Promise<Role[]> => apiGet<Role[]>(BASE);

/**
 * `POST /roles` — `roles:create`. 201 with the created role.
 *
 * `permissions` is required; send `[]` explicitly for a role that can do
 * nothing. De-dupe first — the backend does not, and the array is capped at 43.
 *
 * **A 409 from this route may or may not carry `code`.** A reserved name
 * (`owner`/`manager`/`seller`, trimmed, any casing) is a service check and
 * arrives as `code: "CONFLICT"` with the message
 * `"\"<name>\" is a built-in role name"`. A duplicate *custom* name has no
 * service check at all — it hits the `(organizationId, name)` unique index and
 * surfaces through the generic duplicate-key branch as
 * `{ message: "Resource already exists", errors: { name: "That name is already
 * taken" } }` with **no `code` key** (`error.middleware.ts:105-110`). A form
 * that only reads `code` shows nothing for the second one; read `fieldErrors`
 * too.
 */
export const create = (input: CreateRoleInput): Promise<Role> =>
  apiPost<Role>(BASE, input);

/**
 * `PATCH /roles/:id` — `roles:update`. 200 with the **full** `publicRole`, so
 * the caller gets the merged result and needs no refetch of this one row.
 *
 * A true partial update: absent keys stay absent all the way to
 * `findOneAndUpdate`, so a PATCH of `{ name }` cannot clear the permissions.
 * `{ permissions: [] }` is legal and strips the role bare; `{}` is a 422 whose
 * error lands under the key **`_`** rather than a field name — the client
 * schema refuses that case before it is sent.
 *
 * 403 `"Built-in roles cannot be changed"` for any preset. 404 for an unknown
 * id **and** for another tenant's role — never 403, because a 403 would confirm
 * the id exists.
 */
export const update = (id: ObjectId, input: UpdateRoleInput): Promise<Role> =>
  apiPatch<Role>(`${BASE}/${id}`, input);

/**
 * `DELETE /roles/:id` — `roles:delete`. **200 with no `data` key**, hence
 * `Promise<void>`.
 *
 * The document is genuinely removed from the collection. It is refused first in
 * three ways: 403 for a preset, 404 for unknown-or-cross-tenant, and **409 when
 * any non-removed member still holds it**, with a message built from the live
 * count — `"This role cannot be deleted: 1 member still has it. Move them to
 * another role first."` (`role.service.ts:80-85`).
 *
 * **There is no cascade and no reassignment.** The 409 message is written to be
 * read verbatim by a human, and the only way past it is to move those members
 * onto another role first, which is what the confirm dialog says.
 */
export const remove = (id: ObjectId): Promise<void> =>
  apiDelete<void>(`${BASE}/${id}`);

/**
 * The roles a picker may offer: everything except the Owner preset.
 *
 * Not a filter on `isPreset` — Manager and Seller are presets and are freely
 * assignable by anyone (`member.service.ts:40-46`). Only Owner is refused, and
 * it is matched by identity against the preset rather than by name, so a custom
 * role a business chose to call something Owner-ish is unaffected. (A custom
 * role literally *named* "Owner" cannot exist: reserved, 409.)
 *
 * Lives here, next to `list`, so every screen that offers a role picker filters
 * the same way and none of them has to remember why.
 */
export const assignableRoles = (roles: readonly Role[]): Role[] =>
  roles.filter((role) => !isOwnerPreset(role));

/**
 * True for the un-assignable Owner preset.
 *
 * `isPreset` **and** the name, together: `isPreset` alone would also match
 * Manager and Seller, which are assignable, and the name alone could in
 * principle match a custom role — except it cannot, because `owner` is a
 * reserved name and a custom role can never hold it. Requiring both means this
 * stays correct if either fact changes.
 */
export const isOwnerPreset = (role: Role): boolean =>
  role.isPreset && role.name.trim().toLowerCase() === "owner";
