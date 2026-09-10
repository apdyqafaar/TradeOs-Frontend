import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * The wire shapes of the twelve `/projects` and `/public/projects` rows in
 * `docs/API-ROUTES.md`.
 *
 * Transcribed from `toProjectResponse`
 * (`../Backend/src/db/actions/project.actions.ts:4-19,27-44`),
 * `toProjectUpdateResponse` (`project-update.actions.ts:4-22`) and
 * `public-project.service.ts:35-65`, cross-checked against the verified
 * contract `docs/contracts/projects-announcements.md` §1.5, §1.6 and §3.4.
 * That contract wins over the design canvas and over REST intuition.
 *
 * Three facts run through this whole file and each one is a trap the canvas
 * walks straight into:
 *
 *   1. **Nothing on a project is populated.** `customerId` and `createdBy` are
 *      bare id strings — no customer name, no author name, no `author` object.
 *      Announcements are the opposite (they ship `author: { id, name }`), and
 *      the two shapes look deliberately similar, so a shared "posted by"
 *      component written against the announcement shape renders `undefined`
 *      here (contract trap 4).
 *   2. **`createdBy` is a MEMBER id, not a User id** (`project.controller.ts:36`).
 *      It will not match the `id` a UI holds from `/auth/me`; the value to
 *      compare against is the session's `member.id`.
 *   3. **The share token is not on any of these shapes**, and that is not an
 *      omission here — there is no `shareToken` field on the model at all
 *      (`project.model.ts:31`), only a SHA-256 hash the mapper never reads.
 *      See `PublishResult` below.
 */

/** The five states a project can be in. The API's enum, in the API's order. */
export const PROJECT_STATUSES = [
  "planned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The cover image, denormalised onto the project when an upload is attached
 * (contract §6.2).
 *
 * `uploadId` is here and is load-bearing: it is what `PATCH` resends to keep
 * the cover, and what `<ImagePicker known={…}>` needs to draw a thumbnail for
 * an already-attached image — the gallery only lists *unattached* uploads and
 * there is no `GET /uploads/:id` to fall back on.
 */
export interface ProjectCover {
  uploadId: ObjectId;
  url: string;
  thumbUrl: string;
}

/**
 * One project, identical on list, get, create and patch.
 *
 * `description` may be `""` as well as `null`: `PATCH { description: null }` is
 * a 422 and the closest available "clear" is `description: ""`, which comes
 * back on the wire as an empty string because `toProjectResponse` uses `?? null`
 * and that only catches `null`/`undefined` (contract §1.3). So a screen written
 * as `description == null ? placeholder : description` shows an empty box
 * rather than the placeholder — test for emptiness, not for null.
 */
export interface Project {
  id: ObjectId;
  title: string;
  description: string | null;
  /**
   * A bare Customer id or `null`. **Never populated** — there is no customer
   * name in this response and the Customer collection is not touched on this
   * path. The design canvas shows "Mwangi Stores" on a project card; that name
   * costs a second request per distinct customer.
   *
   * There is also no way to *clear* it once set: `PATCH { customerId: null }`
   * is a 422 (contract §1.3).
   */
  customerId: ObjectId | null;
  status: ProjectStatus;
  /** Integer 0..100. `0` is a real value, never "empty". */
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  /** Whether the public share page currently serves this project. */
  isPublished: boolean;
  /**
   * **"Last published at", not "first published at"** — refreshed on every
   * publish and every regenerate (`project.service.ts:340,374`), and left
   * stale and non-null by `unpublish`. So a non-null `publishedAt` says nothing
   * about whether the project is published; only `isPublished` does.
   */
  publishedAt: string | null;
  cover: ProjectCover | null;
  /** The **Member** id that created it. Bare, never populated. See fact 2. */
  createdBy: ObjectId;
  createdAt: string;
  /**
   * Moves on every internal edit — **and this field is public**. It is one of
   * the three things the public payload exposes (contract §3.5, `FINDINGS` §3),
   * so an anonymous visitor can see the timing of internal activity.
   */
  updatedAt: string;
}

/**
 * One progress note. Immutable: there is no `PATCH .../updates/:updateId`, and
 * the model sets `timestamps: { createdAt: true, updatedAt: false }`
 * (`project-update.model.ts:25-26`) — hence no `updatedAt` here.
 */
export interface ProjectUpdate {
  id: ObjectId;
  projectId: ObjectId;
  body: string;
  /** `null` when the note carried no progress. Not `0` — `0` is a real value. */
  progress: number | null;
  /** Bare **Member** id, never populated. Same as `Project.createdBy`. */
  createdBy: ObjectId;
  createdAt: string;
}

/**
 * `GET /projects?page=&limit=&status=&customerId=` — and that is the entire
 * query surface (contract §1.1).
 *
 * `.strict()`, so **there is no `search`, no date filter, no `isPublished`
 * filter and no `sort`**. `?search=x` is a 422 `Unrecognized key`, not an
 * ignored key. Ordering is fixed at `{ createdAt: -1, _id: -1 }` — newest
 * first — and cannot be asked to be anything else.
 */
export interface ProjectListParams extends PaginationParams {
  status?: ProjectStatus;
  customerId?: ObjectId;
}

/** `GET /projects/:id/updates?page=&limit=` — pagination and nothing else. */
export type ProjectUpdateListParams = PaginationParams;

/**
 * What `publish` and `regenerate-link` answer — **the only two responses in the
 * entire API that ever carry the plain share token** (contract §3.2).
 *
 * `shareToken` is 64 lowercase hex characters, or **`null`**. It is `null`
 * whenever the project already had a hash: the token was never stored, only its
 * SHA-256, so the server genuinely cannot re-issue it
 * (`project.service.ts:333-338,348`). That happens on every
 * `unpublish` → `publish` cycle. The old link still works in that case; the
 * frontend simply has no way to display it unless it kept the value from the
 * original publish.
 *
 * `regenerate-link` always mints, so its `shareToken` is always a string — but
 * it also overwrites the hash, which kills every link already given to a client
 * (contract §3.3, proven `public-link.test.ts:141-166`).
 */
export interface PublishResult {
  shareToken: string | null;
  isPublished: boolean;
  publishedAt: string | null;
}

/**
 * What `unpublish` answers — **only this one key** (contract §3.2). No
 * `publishedAt`, no `shareToken`. Typed separately rather than as a
 * `Partial<PublishResult>` so nothing can destructure a token out of it.
 */
export interface UnpublishResult {
  isPublished: false;
}

/**
 * The share token's shape: 64 **lowercase** hex characters
 * (`SHARE_TOKEN_REGEX`, `project.validation.ts:85`).
 *
 * A correctly-hex but upper-cased token is rejected — verified,
 * `SHARE_TOKEN_REGEX.test("A".repeat(64)) === false`. So never `toUpperCase()`
 * or otherwise normalise a token anywhere on this path.
 */
export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/* ------------------------------------------------------------------------ *
 * The public payload — `GET /public/projects/:token`, no auth at all.
 * ------------------------------------------------------------------------ */

/**
 * The business, as a stranger sees it: **name and logo, nothing else**. No id,
 * slug, currency, phone, address, email, plan or status
 * (`public-project.service.ts:46-49`).
 *
 * `name` is `""` — not `null`, not a 404 — when the organization row is gone
 * (`public-project.service.ts:46-47`), so guard on emptiness rather than on
 * null.
 */
export interface PublicBusiness {
  name: string;
  logo: string | null;
}

/**
 * The project's cover, as a stranger sees it. **`{ url, thumbUrl }` only** —
 * no `uploadId` on the public cover.
 */
export interface PublicProjectCover {
  url: string;
  thumbUrl: string;
}

/**
 * The eight project fields the public whitelist allows, and no others: no `id`,
 * no `customerId`, no `isPublished`, no `publishedAt`, no `createdAt`, no
 * `createdBy`. The key sets are asserted exactly with `Object.keys().sort()` at
 * all three levels by `public-link.test.ts:98-105`, so this interface is a
 * transcription rather than a guess — and widening it would be a CI failure
 * there, not here.
 */
export interface PublicProjectDetail {
  title: string;
  description: string | null;
  status: ProjectStatus;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  cover: PublicProjectCover | null;
}

/**
 * One update, as a stranger sees it: `{ body, progress, createdAt }`. No id, no
 * author, no `projectId`.
 *
 * **Every update ever posted is public the moment the project is**, with no
 * per-update visibility flag anywhere on the model
 * (`project-update.model.ts:8-15`, contract §4.3). Capped at the newest 100
 * (`MAX_PUBLIC_UPDATES`), not paginated — a visitor cannot page past them.
 */
export interface PublicProjectUpdate {
  body: string;
  progress: number | null;
  createdAt: string;
}

/** The whole body of a successful public read. Exactly these three keys. */
export interface PublicProject {
  business: PublicBusiness;
  project: PublicProjectDetail;
  updates: PublicProjectUpdate[];
}
