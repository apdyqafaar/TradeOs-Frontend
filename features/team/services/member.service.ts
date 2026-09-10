import { apiDelete, apiGetList, apiPatch, apiPost } from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  ChangeMemberRoleInput,
  InviteMemberInput,
} from "../schemas/member.schema";
import type { ListedMember, MemberListParams, PublicMember } from "../types";

/**
 * The five `/members` endpoints, and nothing else.
 *
 * No React, no hooks, no toasts. The response interceptor in `lib/api/client`
 * has already unwrapped `{ success, message, data, meta }` and normalised every
 * failure into an `ApiError`, so what these return is the domain object.
 *
 * **No organization id is sent, ever** — nothing in this slice accepts one in
 * any path, body, query or header. `requireMember` resolves the tenant from the
 * caller's own member row, and an id put in the invite body is silently
 * stripped rather than honoured (`invite.test.ts:246-281`).
 *
 * The return types are the point of this file. `list` answers `ListedMember`,
 * which carries the person. The other four answer `PublicMember`, which does
 * not carry the person at all — see `types.ts`. They are typed differently so a
 * component cannot accidentally render one where the other belongs.
 */

const BASE = "/members";

/**
 * `GET /members` — `members:view`. Paginated, so `apiGetList`.
 *
 * `{ params }`, not `params`: the second argument is an axios **config**, and
 * passing the filter object directly hands axios a config full of keys it does
 * not recognise and sends no query string at all — a list stuck on page 1 with
 * no error to show for it.
 *
 * Three facts about what comes back, none of which is adjustable:
 *
 *   - **Removed members are excluded**, always. The filter is hard-coded
 *     `{ organizationId, status: { $ne: "removed" } }` (`member.actions.ts:21-24`)
 *     and shared with the count, so `meta.total` excludes them too. There is no
 *     `?status=` override and no `GET /members/:id` to reach one by id.
 *   - **Oldest first** (`{ createdAt: 1, _id: 1 }`, `member.actions.ts:53`), the
 *     opposite of `GET /sales`. The owner is normally row 1.
 *   - The query schema is `.strict()`: `?search=x` is a **422**, not an ignored
 *     parameter. Send only `page` and `limit`.
 */
export const list = (
  params: MemberListParams,
): Promise<Paginated<ListedMember>> =>
  apiGetList<ListedMember>(BASE, { params });

/**
 * `POST /members/invite` — `members:invite` **plus a verified email**. 201.
 *
 * The verified-email gate is on this route and `resendInvite` only, of all nine
 * in the slice: they are the two endpoints that mail a third party on the
 * caller's say-so. An unverified caller gets **403 with
 * `code: "EMAIL_NOT_VERIFIED"`** — branch on the code, never the message
 * (`auth.middleware.ts:98-109`). It is a real state for a brand-new owner.
 *
 * The refusals a form has to speak for, all 409 unless noted:
 *
 *   - inviting **yourself** — `"You are already a member of this business"`,
 *     refused before any write or mail, and case-insensitive;
 *   - the invitee already belongs to **any** business on TradeOs;
 *   - the invitee already has a pending invite here;
 *   - **403** when `roleId` is the Owner preset — filter Owner out of the
 *     picker rather than letting someone choose a 403;
 *   - **404** for an unknown role, and for another tenant's custom role, which
 *     is 404 and never 403 so an id cannot be probed;
 *   - **429** with a `Retry-After` header — see the note on `resendInvite`.
 *
 * And one non-refusal: **a mail that fails to send still answers 201.** The
 * invite row and its token survive so it can be resent, but "Invitation sent"
 * is not proof of delivery (`member.service.ts:180-185`).
 */
export const invite = (input: InviteMemberInput): Promise<PublicMember> =>
  apiPost<PublicMember>(`${BASE}/invite`, input);

/**
 * `POST /members/:id/resend-invite` — `members:invite` **plus a verified
 * email**. 200 with a bare `publicMember`: no `role` key, unlike invite.
 *
 * **No body, and the schema is strict-empty** — any payload is a 422. You
 * cannot correct a mistyped address by resending; cancel the invitation
 * (`remove`) and send a new one.
 *
 * 409 `"That member has already accepted their invitation"` covers both the
 * accepted and the removed cases — the guard is `status !== "invited"`.
 *
 * **The 429 here is the business's quota, not the caller's.** One bucket of 50
 * per hour keyed on the organization is shared between this route and
 * `invite`, across all members (`member.route.ts:74-79`;
 * `invite-guards.test.ts:259-295` asserts the literal key). A business that has
 * spent its hour sending fresh invitations cannot then spend it on resends, and
 * a 429 here can be caused by somebody else's invitations entirely.
 */
export const resendInvite = (id: ObjectId): Promise<PublicMember> =>
  apiPost<PublicMember>(`${BASE}/${id}/resend-invite`, undefined);

/**
 * `PATCH /members/:id` — `members:update`. 200 with `publicMember` **plus**
 * `role: { id, name }`.
 *
 * One field, and it is required: `{}` is a 422, not a no-op. This endpoint
 * changes only the role — name, email and status are not editable through it.
 *
 * Refused with 403 for the organization's owner (`"The owner's role cannot be
 * changed"`, matched on `Organization.ownerId` rather than a role name) and 403
 * for promoting anyone **to** Owner. 409 when the member has been removed.
 *
 * No session is revoked, deliberately: the API rebuilds the target's
 * permissions from the member row on every request, so a demotion binds on
 * their very next call with no re-login (`permissions-middleware.test.ts:122-133`).
 * Do not sign anybody out after this. **Do** refetch `GET /auth/me` if the
 * caller re-roled themselves — there is no self-check on this endpoint, so a
 * manager holding `members:update` can demote themselves out of the screen.
 */
export const changeRole = (
  id: ObjectId,
  input: ChangeMemberRoleInput,
): Promise<PublicMember> => apiPatch<PublicMember>(`${BASE}/${id}`, input);

/**
 * `DELETE /members/:id` — `members:remove`. **200 with a body. Not 204.**
 *
 * **This deactivates; it does not delete.** The row survives with
 * `status: "removed"`, keeps its `userId` so past sales stay attributable, and
 * every session that user holds is revoked synchronously — their next request
 * is a 401 (`manage.test.ts:459-491`). It is not undoable from this screen:
 * bringing someone back is a fresh invitation, which reactivates the same row.
 *
 * **Cancelling a pending invitation is this same call.** There is no separate
 * cancel-invite route; an invited row flips to `removed` and, having no
 * `userId`, disturbs nobody's session.
 *
 * Guards, in the order the server applies them: 404 unknown-or-cross-tenant,
 * 409 already removed, **403 removing the owner**, **403 removing yourself**.
 * The owner check is first, so a manager who targets the owner gets the owner
 * message and not the self one.
 *
 * Note the sibling asymmetry this shares a verb with: `DELETE /roles/:id` is a
 * genuine hard delete answering **no `data` key at all**. One generic delete
 * handler cannot serve both, which is why this slice has two.
 */
export const remove = (id: ObjectId): Promise<PublicMember> =>
  apiDelete<PublicMember>(`${BASE}/${id}`);
