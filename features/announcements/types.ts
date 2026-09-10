import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * The wire shapes of the five `/announcements` rows in `docs/API-ROUTES.md`.
 *
 * Transcribed from `toAnnouncementResponse`
 * (`../Backend/src/db/actions/announcement.actions.ts:28-38,46-72`) and
 * cross-checked against the verified contract,
 * `docs/contracts/projects-announcements.md` §2.4. That contract wins over the
 * design canvas and over REST intuition, and it is what these types encode.
 *
 * Two facts run through the whole file, and they are the two most likely to be
 * assumed wrongly:
 *
 *   1. **This is the one shape in the projects/announcements pair that comes
 *      back populated.** `author: { id, name }` is on every read, so a feed can
 *      name a person with no second request — the opposite of `Project`, whose
 *      `createdBy` is a bare id. A shared "posted by" component written against
 *      this shape renders `undefined` on a project (contract trap 4).
 *   2. **`createdAt` / `updatedAt` are ISO 8601 strings, not `Date`s.** The
 *      mapper hands Mongoose `Date`s to `JSON.stringify` and nothing on this
 *      side revives them. Feed them to `formatRelative(iso, timezone)` with the
 *      business timezone — there is no safe default (CLAUDE.md §Conventions).
 */

/**
 * The cover image, denormalised onto the announcement when an upload is
 * attached (contract §6.2).
 *
 * `uploadId` is here and is not decoration: it is what `PATCH` must resend to
 * keep the cover, and what `<ImagePicker known={…}>` needs to draw a thumbnail
 * for an already-attached image — the gallery only lists *unattached* uploads,
 * and there is no `GET /uploads/:id` to fall back on.
 */
export interface AnnouncementCover {
  uploadId: ObjectId;
  url: string;
  thumbUrl: string;
}

/**
 * The author, populated in one hop `createdBy` → `Member.userId` → `User.name`
 * (`AUTHOR_POPULATE`, `announcement.actions.ts:17-21`).
 *
 * **`id` is a Member id, not a User id** — proven on the wire by
 * `announcements.test.ts:75`, `expect(author).toEqual({ id: member.id, name:
 * user.name })`. So it will not match the id a UI holds from `/auth/me`; the
 * value to compare against is the session's `member.id`. `name`, meanwhile,
 * comes from the **User** row.
 *
 * `name` is the literal string `"Removed member"` when the User row is gone
 * (account deletion), not merely when the member left the business
 * (`announcement.actions.ts:12-15,53`). And if the populate fails outright,
 * both `id` here and `createdBy` below are `""` — an empty string, never
 * `null`, so `author.id ? … : …` is the guard that works and `author.id ??` is
 * the one that does not.
 */
export interface AnnouncementAuthor {
  id: ObjectId;
  name: string;
}

/**
 * One announcement, identical on list, get, create and patch.
 *
 * **`pinned` is the only state flag that exists** (contract §2.5). There is no
 * draft/publish state, no audience, no scheduling, no expiry, no read tracking
 * and no soft delete: an announcement is live to every member the moment it is
 * created, and deleting one is a hard `findOneAndDelete` with no undo.
 */
export interface Announcement {
  id: ObjectId;
  title: string;
  /** Plain text, max 5000 chars. Not markdown, not HTML — render it as text. */
  body: string;
  pinned: boolean;
  cover: AnnouncementCover | null;
  /**
   * The **Member** id that created it. Always the same string as `author.id`
   * (both are `createdBy?.id ?? ""`, `announcement.actions.ts:52,67-68`), kept
   * because it is the field the API documents and the one a future
   * "my announcements" filter would use.
   *
   * Note it is *not* an authorship gate: editing and deleting are
   * permission-based, and any member holding `announcements:update` may edit
   * anyone's (contract §2.3, trap 12). Do not hide Edit on "not your post".
   */
  createdBy: ObjectId;
  author: AnnouncementAuthor;
  createdAt: string;
  /** Moves on every edit. Editing never reassigns `createdBy` / `author`. */
  updatedAt: string;
}

/**
 * `GET /announcements?page=&limit=` — and that is the entire query surface of
 * this feature (contract §2.1).
 *
 * `listAnnouncementsQuerySchema` is `z.object({ ...paginationQuerySchema.shape
 * }).strict()`: **no search, no `pinned` filter, no author filter, no date
 * window, no `sort`**. `?search=x` is a 422 `Unrecognized key`, not an ignored
 * key — so a search box on this screen would break the list rather than
 * narrowing it, and a client-side filter over one page of N would lie about the
 * rest.
 *
 * Defaults are the server's: `page` 1, `limit` 20, `limit` capped at 100
 * (`common.validation.ts:28-29`).
 */
export type AnnouncementListParams = PaginationParams;

/**
 * The server's ordering, restated because the UI depends on it and cannot ask
 * for anything else: `{ pinned: -1, createdAt: -1, _id: -1 }`
 * (`announcement.actions.ts:100`), with a matching index.
 *
 * **The sort runs before pagination.** Pinned items occupy the head of page 1
 * and push older ones onto page 2; there is no cap on how many may be pinned
 * and no server-side "unpin the previous one". A business that pins six notices
 * has a first page that is mostly pins — which is worth knowing before deciding
 * a feed does not need its pagination control.
 */
export const ANNOUNCEMENT_SORT = "pinned first, then newest" as const;
