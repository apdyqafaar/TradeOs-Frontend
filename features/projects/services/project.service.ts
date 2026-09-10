import {
  apiDelete,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
} from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  CreateProjectInput,
  CreateProjectUpdateInput,
  UpdateProjectInput,
} from "../schemas/project.schema";
import type {
  Project,
  ProjectListParams,
  ProjectUpdate,
  ProjectUpdateListParams,
  PublishResult,
  UnpublishResult,
} from "../types";

/**
 * The only file in this slice that knows an authenticated URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * All eleven authenticated `/projects` rows in `docs/API-ROUTES.md` are wrapped
 * here and nothing else is. **The twelfth — `GET /public/projects/:token` — is
 * deliberately not**: it is fetched server-side with `fetch` against the API
 * origin, because this axios instance is built for the browser. See
 * `public-project.service.ts`.
 *
 * **No organization id is sent** — `requireMember` resolves the tenant from the
 * caller's session on every request, and a project belonging to another
 * business is a 404 rather than a 403 so an id cannot be probed
 * (`project.service.ts:155`).
 *
 * Two things about this feature's error surface, both from the verified
 * contract (§7):
 *
 *   - **`ALREADY_PUBLISHED` is the only domain 409.** There is deliberately no
 *     `NOT_PUBLISHED`, no `ALREADY_UNPUBLISHED` and no `NO_SHARE_LINK` —
 *     unpublish and regenerate never conflict.
 *   - **Validation runs before auth** on every route (contract Trap 0), so a
 *     malformed body from an anonymous caller is a 422, not a 401. Do not build
 *     anything that reads "422 means the session is fine".
 */

const BASE = "/projects";

/**
 * `GET /projects` — `projects:view`. Paginated, so `apiGetList`.
 *
 * `{ params }`, not `params`: the second argument is an axios *config*, and
 * passing the filter object directly would hand axios a config full of keys it
 * does not recognise and send no query string at all — a list that silently
 * ignores the page and stays on page 1. (The scaffolder's `service.ts.template`
 * writes `apiGetList(BASE, params)`; it is wrong, and it has been written wrong
 * in this repo once already.)
 *
 * `page`, `limit`, `status` and `customerId` are the only four keys the schema
 * accepts and it is `.strict()`, so `?search=` is a **422**, not an ignored key.
 * Ordering is fixed at `{ createdAt: -1, _id: -1 }` — newest first, `_id` as
 * the tiebreak — and there is no `sort` param to change it.
 */
export const list = (
  params: ProjectListParams = {},
): Promise<Paginated<Project>> => apiGetList<Project>(BASE, { params });

/**
 * `GET /projects/:id` — `projects:view`.
 *
 * **This does not return the share token, and no read endpoint does.** It
 * carries `isPublished` and `publishedAt`, and that is the whole of what a
 * reader learns about the share link (`project.actions.ts:21-26`, proven by
 * `projects.test.ts:98-111`). A "Copy link" control that expects to re-read the
 * token on page load renders an empty string forever — contract trap 1.
 *
 * A malformed id is a **422, not a 404**: `:id` is `objectIdSchema` and
 * `validate` runs before the handler. An unknown or cross-tenant id is the 404.
 */
export const getById = (id: ObjectId): Promise<Project> =>
  apiGet<Project>(`${BASE}/${id}`);

/**
 * `POST /projects` — `projects:create`. 201 with the created row.
 *
 * Two refusal families a form must handle:
 *
 *   - **404 `NOT_FOUND` `"Customer not found"`** when `customerId` is unknown or
 *     belongs to another business. A 404 on a *create*, which is unusual enough
 *     to be worth stating: it is checked before anything is written
 *     (`project.service.ts:35-41,88`, proven `projects.test.ts:78-96`). It
 *     belongs at the customer field, not at the top of the form.
 *   - The three cover refusals — 404 `"Upload not found"`, 409
 *     `UPLOAD_PURPOSE_MISMATCH` (the upload's purpose must be `"project"`) and
 *     409 `UPLOAD_ATTACHED`. The attach runs **inside this request's
 *     transaction**, so any of them rolls the whole write back and there is no
 *     coverless project left behind for a retrying client to duplicate
 *     (`attachments.service.ts:36-68`).
 */
export const create = (input: CreateProjectInput): Promise<Project> =>
  apiPost<Project>(BASE, input);

/**
 * `PATCH /projects/:id` — `projects:update`. 200 with the updated row.
 *
 * **Never call this with `{}`.** The body carries an object-level refine, so an
 * empty patch is a 422 whose message lands under the key `"_"` — build the body
 * with `projectPatch`, which returns `null` when nothing changed.
 *
 * **It cannot clear anything except the cover.** `description: null`,
 * `customerId: null`, `startDate: null` and `dueDate: null` are each a 422;
 * only `coverUploadId` is nullable (contract §1.3). And `isPublished` is
 * `.strict()`-rejected — publishing is not a field, it is the three routes
 * below.
 */
export const update = (
  id: ObjectId,
  input: UpdateProjectInput,
): Promise<Project> => apiPatch<Project>(`${BASE}/${id}`, input);

/**
 * `DELETE /projects/:id` — `projects:delete`. **204 with no body at all**, not
 * `{ success: true }` (`responses.ts:50`, contract §0).
 *
 * Typed `Promise<void>` for that reason: there is nothing to read off the
 * response.
 *
 * A **hard delete that cascades**: every progress note on the project is
 * removed in the same transaction (`project.service.ts:215-239`, proven by
 * `projects.test.ts:195-215` — `countDocuments === 0` afterwards), and the
 * cover image is released from storage once it commits. There is no soft delete
 * and no undo. This belongs behind a confirmation that says so.
 */
export const remove = (id: ObjectId): Promise<void> =>
  apiDelete<void>(`${BASE}/${id}`);

/**
 * `GET /projects/:id/updates` — `projects:view`. Paginated, newest first.
 *
 * An unknown project id is a **404 `"Project not found"`, not an empty list**:
 * the service checks the project exists before listing
 * (`project.service.ts:246-247`). `meta.total` and `data` are read concurrently
 * against the same filter, so they always describe the same set.
 */
export const listUpdates = (
  projectId: ObjectId,
  params: ProjectUpdateListParams = {},
): Promise<Paginated<ProjectUpdate>> =>
  apiGetList<ProjectUpdate>(`${BASE}/${projectId}/updates`, { params });

/**
 * `POST /projects/:id/updates` — **`projects:update`**, not `projects:create`
 * (`project.route.ts:92-94`). 201 with the created note.
 *
 * **This mutates the project row.** When `progress` is supplied it is written
 * onto the project inside the same transaction
 * (`project.service.ts:291-294`, proven `projects.test.ts:135-163`), so any
 * cached `Project` is stale the moment this resolves — and a grid rendered
 * elsewhere is showing the old bar. The hook invalidates both branches for that
 * reason.
 *
 * A note without `progress` leaves the project untouched and comes back with
 * `progress: null`. Send no key rather than `progress: null`, which is a 422.
 */
export const createUpdate = (
  projectId: ObjectId,
  input: CreateProjectUpdateInput,
): Promise<ProjectUpdate> =>
  apiPost<ProjectUpdate>(`${BASE}/${projectId}/updates`, input);

/**
 * `DELETE /projects/:id/updates/:updateId` — **`projects:update`**, not
 * `projects:delete`. **204, empty.**
 *
 * **Deleting a note does not roll the project's progress back.** Nothing
 * recomputes it: a note that set progress to 40 leaves the project at 40 after
 * the note is gone (`project.service.ts:305-315` contains no progress logic).
 * A UI offering "undo" here would silently lie, which is why the dialog says
 * what actually happens instead.
 *
 * An `updateId` belonging to a sibling project is a 404 `"Project update not
 * found"` — the delete is scoped by organization AND project AND id
 * (`project-update.actions.ts:52-57`, proven `projects.test.ts:165-193`).
 */
export const removeUpdate = (
  projectId: ObjectId,
  updateId: ObjectId,
): Promise<void> => apiDelete<void>(`${BASE}/${projectId}/updates/${updateId}`);

/**
 * `POST /projects/:id/publish` — `projects:publish`. 200.
 *
 * **This is the one moment the share token exists.** It is 32 random bytes
 * stored only as a SHA-256 hash (`lib/tokens.ts:4,11-12`,
 * `project.model.ts:31`); no read endpoint returns it, and a re-publish of an
 * already-hashed project answers **`shareToken: null`** because the plain value
 * was never stored (`project.service.ts:333-338,348`). Whatever calls this must
 * capture `shareToken` immediately — see `share-card.tsx`.
 *
 * **409 `ALREADY_PUBLISHED`** on an already-published project
 * (`project.service.ts:331`, proven on the wire `public-link.test.ts:66-68`).
 * That is the only conflict in the feature.
 *
 * **No body.** `noBodySchema` is `z.object({}).strict().optional()`, so `{}`
 * would be fine but `{ projectId }` is a 422 — hence nothing is passed here and
 * no HTTP wrapper may helpfully attach a payload (contract §0).
 */
export const publish = (id: ObjectId): Promise<PublishResult> =>
  apiPost<PublishResult>(`${BASE}/${id}/publish`);

/**
 * `POST /projects/:id/unpublish` — `projects:publish` (the same permission;
 * there is no separate unpublish permission). 200.
 *
 * Answers **`{ isPublished: false }` and nothing else** — no `publishedAt`, no
 * `shareToken` — so do not destructure the publish response type from it
 * (contract §3.2, trap 6).
 *
 * **The link dies instantly.** The public lookup filters on
 * `{ shareTokenHash, isPublished: true }` in one query with no cache and no
 * grace period (`project.actions.ts:130-131`, proven
 * `public-link.test.ts:126-130`). It is also reversible: publishing again
 * without regenerating restores the *same* link, because the hash is untouched.
 *
 * It never conflicts — unpublishing an already-unpublished project is a 200
 * no-op.
 */
export const unpublish = (id: ObjectId): Promise<UnpublishResult> =>
  apiPost<UnpublishResult>(`${BASE}/${id}/unpublish`);

/**
 * `POST /projects/:id/regenerate-link` — `projects:publish`. 200, and its
 * `shareToken` is **always** a string.
 *
 * Two consequences the calling screen has to state before it fires this:
 *
 *   1. **Every link already given to a client stops working immediately**, by
 *      overwriting the hash (`project.service.ts:362-364`, proven
 *      `public-link.test.ts:141-166`). This is the *only* way to recover a lost
 *      token, and the recovery costs exactly that.
 *   2. **It publishes a never-published project as a side effect**
 *      (`project.service.ts:376-380`), and it never conflicts — there is no
 *      `ALREADY_PUBLISHED` on this route.
 *
 * `publishedAt` is refreshed here too, which is why it means "last published
 * at" rather than "first published at".
 */
export const regenerateLink = (id: ObjectId): Promise<PublishResult> =>
  apiPost<PublishResult>(`${BASE}/${id}/regenerate-link`);
