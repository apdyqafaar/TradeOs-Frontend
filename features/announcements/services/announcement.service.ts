import {
  apiDelete,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
} from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "../schemas/announcement.schema";
import type { Announcement, AnnouncementListParams } from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * All five `/announcements` rows in `docs/API-ROUTES.md` are wrapped here and
 * nothing else is. **No organization id is sent** — `requireMember` resolves
 * the tenant from the caller's session on every request, and an announcement
 * belonging to another business is a 404 rather than a 403 so an id cannot be
 * probed (`announcement.service.ts:138`).
 *
 * Two things about this feature's error surface, both from the verified
 * contract (§7):
 *
 *   - **The only domain error is 404 `NOT_FOUND` `"Announcement not found"`.**
 *     There is no 409 anywhere and no conflict condition at all — unlike
 *     projects, which have `ALREADY_PUBLISHED`. The 409s that *are* reachable
 *     come from the shared cover-attachment path, not from announcements.
 *   - **Validation runs before auth** on every route (contract Trap 0), so a
 *     malformed body from an anonymous caller is a 422, not a 401. Do not build
 *     anything that reads "422 means the session is fine".
 */

const BASE = "/announcements";

/**
 * `GET /announcements` — `announcements:view`. Paginated, so `apiGetList`.
 *
 * **Every preset holds `announcements:view`** — Owner by wildcard, Manager by
 * `ALL_PERMISSIONS`, and Seller explicitly (`lib/permissions.ts:133`, contract
 * §5) — so this is the one list screen in the product that every member can
 * open. Gate the *controls* on create/update/delete; do not gate the page.
 *
 * `{ params }`, not `params`: the second argument is an axios *config*, and
 * passing the filter object directly would hand axios a config full of keys it
 * does not recognise and send no query string at all — a list that silently
 * ignores the page and stays on page 1. (The scaffolder's `service.ts.template`
 * writes `apiGetList(BASE, params)`; it is wrong, and it has been written wrong
 * in this repo once already.)
 *
 * `page` and `limit` are the only two keys the schema accepts and it is
 * `.strict()`, so `?search=` is a 422 rather than an ignored key.
 *
 * Ordering is fixed: pinned first, then newest, `_id` as the tiebreak — applied
 * *before* pagination, so pins occupy the head of page 1.
 */
export const list = (
  params: AnnouncementListParams = {},
): Promise<Paginated<Announcement>> =>
  apiGetList<Announcement>(BASE, { params });

/**
 * `GET /announcements/:id` — `announcements:view`.
 *
 * Answers the same populated shape the list rows carry, `author` included, so a
 * reading screen navigated to from the feed needs no extra request to name the
 * person who wrote it.
 *
 * A malformed id is a **422, not a 404**: `:id` is `objectIdSchema` and
 * `validate` runs before the handler (contract §1, `common.validation.ts:5-7`).
 * An unknown or cross-tenant id is the 404.
 */
export const getById = (id: ObjectId): Promise<Announcement> =>
  apiGet<Announcement>(`${BASE}/${id}`);

/**
 * `POST /announcements` — `announcements:create`. 201 with the created row,
 * `cover` already populated when one was attached.
 *
 * The cover is attached **inside this request's transaction**
 * (`attachments.service.ts:36-68`, called within `dbSession.withTransaction`),
 * so a bad `coverUploadId` rolls the whole write back and there is no coverless
 * announcement left behind for a retrying client to duplicate. That is why the
 * three cover refusals below are safe to surface at the image control and
 * retry from there:
 *
 *   - 404 `NOT_FOUND` `"Upload not found"`
 *   - 409 `UPLOAD_PURPOSE_MISMATCH` — the upload's `purpose` must be
 *     `"announcement"`, not `"project"` or `"product"`
 *     (`announcement.service.ts:46`)
 *   - 409 `UPLOAD_ATTACHED` — already claimed by another resource
 */
export const create = (input: CreateAnnouncementInput): Promise<Announcement> =>
  apiPost<Announcement>(BASE, input);

/**
 * `PATCH /announcements/:id` — `announcements:update`. 200 with the updated row.
 *
 * **Permission-based, not author-based**: any member holding
 * `announcements:update` may edit any announcement, there is deliberately no
 * `createdBy` check (`announcement.service.ts:142-146`), and editing does not
 * reassign authorship (`announcements.test.ts:125-127`). Do not hide Edit on
 * "not your post".
 *
 * **Never call this with `{}`.** The body carries an object-level refine, so an
 * empty patch is a 422 whose message lands under the key `"_"` — build the body
 * with `announcementPatch`, which returns `null` when nothing changed.
 *
 * The write is a `$set`, proven on the wire: patching `{title, pinned}` leaves
 * `createdBy` intact (`announcements.test.ts:118-127`). Omitted keys are not
 * written; a present `coverUploadId: null` **is** written, and permanently
 * deletes the image.
 */
export const update = (
  id: ObjectId,
  input: UpdateAnnouncementInput,
): Promise<Announcement> => apiPatch<Announcement>(`${BASE}/${id}`, input);

/**
 * `DELETE /announcements/:id` — `announcements:delete`. **204 with no body at
 * all**, not `{ success: true }` (`responses.ts:50`, contract §0).
 *
 * Typed `Promise<void>` for that reason: there is nothing to read off the
 * response, and a caller that awaited a row back would be awaiting `undefined`.
 *
 * A **hard delete** — `findOneAndDelete`, no soft-delete flag, no restore path
 * (`announcement.actions.ts:126-131`, proven by `announcements.test.ts:166-182`:
 * delete then get is a 404). If the announcement had a cover, the image is
 * released from storage after the transaction commits and is gone too. This
 * belongs behind a confirmation.
 */
export const remove = (id: ObjectId): Promise<void> =>
  apiDelete<void>(`${BASE}/${id}`);
