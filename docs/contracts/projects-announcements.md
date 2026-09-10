# Projects & Announcements — API contract

Extracted read-only from `Backend` (no edits made there). Every claim below is
`file:line` against that repo as of this read.

Chains traced:

```
src/routes/v1/project.route.ts      -> src/controller/project.controller.ts
  -> src/services/project.service.ts
  -> src/db/actions/project.actions.ts        -> src/db/models/project.model.ts
  -> src/db/actions/project-update.actions.ts -> src/db/models/project-update.model.ts

src/routes/v1/public.route.ts       -> src/controller/public.controller.ts
  -> src/services/public-project.service.ts   -> the same two actions files

src/routes/v1/announcement.route.ts -> src/controller/announcement.controller.ts
  -> src/services/announcement.service.ts
  -> src/db/actions/announcement.actions.ts   -> src/db/models/announcement.model.ts
```

Plus `src/validators/project.validation.ts`, `src/validators/announcement.validation.ts`,
`src/validators/common.validation.ts`, `src/services/attachments.service.ts`,
`src/lib/tokens.ts`, `src/lib/permissions.ts`, `src/util/responses.ts`,
`src/util/errors.ts`, `src/middleware/validate.middleware.ts`,
`src/middleware/rate-limit.middleware.ts`, `src/middleware/auth.middleware.ts`,
`src/middleware/error.middleware.ts`, `src/db/models/upload.model.ts`,
`src/services/upload.service.ts`, `src/lib/storage.ts`.

Tests read: `tests/integration/projects/projects.test.ts`,
`tests/integration/projects/public-link.test.ts`,
`tests/integration/announcements/announcements.test.ts`, and — because neither
of those suites tests covers at all — `tests/integration/uploads/attach.test.ts`.

All paths below are relative to `/api/v1` (`Backend/src/app.ts:54`). Routers are
mounted at `/projects`, `/announcements` and `/public`
(`Backend/src/routes/v1/index.ts:44-46`).

---

## 0. Middleware chain and envelope

### The 16 authenticated routes

Every one declares its own full chain per route, never as `router.use(...)`
(`project.route.ts:31-37`, `announcement.route.ts:22-27`):

```
validate({ params?, query?, body }) -> requireAuth -> requireMember -> requirePermission(PERMISSIONS.X) -> handler
```

**Trap 0 — validation runs before auth.** A malformed body/query/params on an
anonymous request returns **422, not 401**. The "anonymous caller gets 401"
tests only pass because they send well-formed bodies
(`projects.test.ts:301-311`, `announcements.test.ts:240-250`). Same defect class
as the sales contract's Trap 0; do not build a 401-only "session expired"
interceptor.

No route in either feature carries `requireVerifiedEmail`
(`project.route.ts:34-37`, `announcement.route.ts:25-27`) — an unverified user
with the right permission can create, edit, publish and delete freely.

Every route that takes no body still declares `body: noBodySchema`
(`common.validation.ts:21`):

```ts
export const noBodySchema = z.object({}).strict().optional();
```

`.optional()` because a GET/DELETE with no `Content-Type` leaves `req.body`
`undefined` under Express 5. `.strict()` means **`POST /projects/:id/publish`
with a body of `{}` is fine, but `{ projectId: "..." }` is a 422** — do not let
an HTTP wrapper helpfully attach a payload to the publish/unpublish/regenerate
calls.

### The one unauthenticated route

`GET /public/projects/:token` (`public.route.ts:16-21`) has **no auth chain at
all**:

```
rateLimit({ name: "public-project", windowMs: 60_000, max: 60 })
  -> validate({ params: z.object({ token: z.string().max(128) }) })
  -> getPublicProject
```

The rate limiter is deliberately mounted **first**, ahead of validation
(`public.route.ts:9-15`).

### Envelope

`successResponse` / `createdResponse` / `paginatedResponse` / `noContentResponse`
(`responses.ts:31-61`). Success bodies are `{ success, message, data }`, plus
`meta` on the two list endpoints. `meta` is always exactly
`{ page, limit, total, totalPages }` with `totalPages = Math.ceil(total / limit)`
computed server-side (`responses.ts:58-61`). `DELETE` returns **204 with no body
at all** (`responses.ts:50`) — not `{ success: true }`.

Failures are `{ success, message, code?, errors?, details? }`
(`responses.ts:63-79`), with `code` mirroring `AppError.code`
(`error.middleware.ts:80-98`).

The wire id is **`id`, never `_id`**, on every mapper in both features
(`project.actions.ts:28`, `project-update.actions.ts:16`,
`announcement.actions.ts:56`). `organizationId` appears in no response body
anywhere in either feature.

---

## 1. Projects — the twelve routes

| # | Method | Path | Permission | Success |
|---|---|---|---|---|
| 1 | GET | `/projects` | `projects:view` | 200 `{data: Project[], meta}` |
| 2 | POST | `/projects` | `projects:create` | 201 `{data: Project}` |
| 3 | GET | `/projects/:id` | `projects:view` | 200 `{data: Project}` |
| 4 | PATCH | `/projects/:id` | `projects:update` | 200 `{data: Project}` |
| 5 | DELETE | `/projects/:id` | `projects:delete` | **204, empty** |
| 6 | GET | `/projects/:id/updates` | `projects:view` | 200 `{data: ProjectUpdate[], meta}` |
| 7 | POST | `/projects/:id/updates` | `projects:update` | 201 `{data: ProjectUpdate}` |
| 8 | DELETE | `/projects/:id/updates/:updateId` | `projects:update` | **204, empty** |
| 9 | POST | `/projects/:id/publish` | `projects:publish` | 200 `{data: PublishResult}` |
| 10 | POST | `/projects/:id/unpublish` | `projects:publish` | 200 `{data: {isPublished}}` |
| 11 | POST | `/projects/:id/regenerate-link` | `projects:publish` | 200 `{data: PublishResult}` |
| 12 | GET | `/public/projects/:token` | **none** | 200 `{data: PublicProject}` |

Route declarations: `project.route.ts:38,47,56,65,74,83,95,104,113,122,131`,
`public.route.ts:16`.

Note **#7 and #8 both take `projects:update`, not `projects:create` /
`projects:delete`** (`project.route.ts:92-94,100,109`). Posting or deleting a
progress note is modelled as a write on the project.

`:id` and `:updateId` are `objectIdSchema` — 24 hex chars, case-insensitive
(`common.validation.ts:5-7`, `project.validation.ts:72,74`). **A malformed id is
a 422, not a 404.**

### 1.1 `GET /projects` — query schema

`listProjectsQuerySchema` (`project.validation.ts:58-60`):

```ts
z.object({
  ...paginationQuerySchema.shape,               // page, limit
  status: z.enum(["planned","in_progress","on_hold","completed","cancelled"]).optional(),
  customerId: objectIdSchema.optional(),
}).strict()
```

| param | type | default | source |
|---|---|---|---|
| `page` | coerced int, ≥1 | **`1`** | `common.validation.ts:28` |
| `limit` | coerced int, 1..100 | **`20`** | `common.validation.ts:29` |
| `status` | the 5-member enum | none (no filter) | `project.validation.ts:4,59` |
| `customerId` | 24-hex ObjectId | none (no filter) | `project.validation.ts:59` |

`.strict()`, so an unknown query key is a 422, not a silent drop. Verified by
running the real schema:

```
listProjectsQuerySchema.parse({})          -> { page: 1, limit: 20 }
listProjectsQuerySchema.parse({ pge: "3" }) -> FAIL  Unrecognized key: "pge"
```

There is **no `search` param, no `q`, no date filter, no `isPublished` filter,
no `sort` param**. Sort is fixed at `{ createdAt: -1, _id: -1 }`
(`project.actions.ts:78`) — newest first, `_id` as the tiebreak for equal
timestamps.

Filters are ANDed and applied only when truthy (`project.actions.ts:65-70`).

### 1.2 `POST /projects` — body schema

`createProjectSchema` (`project.validation.ts:35-41`), built from
`projectFields` (`:23-33`):

```ts
z.object({
  title:         z.string().trim().min(1).max(150),                 // REQUIRED
  description:   z.string().trim().max(5000).optional(),            // note: no .min()
  customerId:    objectIdSchema.optional(),
  status:        z.enum(["planned","in_progress","on_hold","completed","cancelled"])
                   .default("planned"),                             // ← DEFAULT
  progress:      z.number().int().min(0).max(100).default(0),       // ← DEFAULT
  startDate:     z.string().datetime().optional(),
  dueDate:       z.string().datetime().optional(),
  coverUploadId: objectIdSchema.nullable().optional(),
}).strict()
```

**Every `.default()` in the projects feature, exhaustively:**

- `createProjectSchema.status` -> `"planned"` (`project.validation.ts:38`)
- `createProjectSchema.progress` -> `0` (`project.validation.ts:39`)
- `paginationQuerySchema.page` -> `1`, `.limit` -> `20`
  (`common.validation.ts:28-29`), inherited by `listProjectsQuerySchema` and
  `listProjectUpdatesQuerySchema`

That is all four. `title` has **no** default and is a hard 422 if missing.
`createProjectUpdateSchema` has **no** defaults at all.

Verified against the real schema:

```
createProjectSchema.parse({ title: "T" })
  -> { title: "T", status: "planned", progress: 0 }
createProjectSchema.parse({})
  -> FAIL  title: expected string, received undefined
createProjectSchema.parse({ title: "  Hi  " })
  -> { title: "Hi", ... }                          // .trim() applies
createProjectSchema.parse({ title: "   " })
  -> FAIL  Too small: expected string to have >=1 characters   // trim then min
createProjectSchema.parse({ title:"T", progress: 100.5 })
  -> FAIL  expected int
createProjectSchema.parse({ title:"T", status: "done" })
  -> FAIL  Invalid option: expected one of "planned"|"in_progress"|"on_hold"|"completed"|"cancelled"
```

**Dates need a full ISO datetime with `Z`.** `z.string().datetime()` in zod
4.4.3 defaults to `offset: false`:

```
startDate: "2026-01-01"                  -> FAIL  Invalid ISO datetime
startDate: "2026-01-01T00:00:00.000Z"    -> OK
startDate: "2026-01-01T00:00:00+02:00"   -> FAIL  Invalid ISO datetime
```

Same bite as `dueDate` on `POST /sales` (see `sales.md` correction 3). Build the
instant, serialise through a plain `Date`.

`customerId` is checked against the caller's own organization before anything is
written (`project.service.ts:35-41,88`) — an unknown or cross-tenant customer id
is **404 `Customer not found`**, not 422. Proven by `projects.test.ts:78-96`.

### 1.3 `PATCH /projects/:id` — and the `.partial()` defect check

`updateProjectSchema` (`project.validation.ts:50-56`):

```ts
z.object(projectFields)        // the UN-defaulted shape, :23-33
  .partial()
  .strict()
  .refine(d => Object.values(d).some(v => v !== undefined),
          { message: "At least one field must be provided" })
```

**The `.partial()`-keeps-defaults defect is genuinely fixed in both files, and
the fix is load-bearing.** Both `project.validation.ts:6-22` and
`announcement.validation.ts:7-20` claim this; the task asked for that claim to be
verified rather than trusted, so the real validators were executed against the
repo's own zod 4.4.3 (`node_modules/zod/package.json`):

```
updateProjectSchema.safeParse({})        -> FAIL  "At least one field must be provided"
updateAnnouncementSchema.safeParse({})   -> FAIL  "At least one field must be provided"
updateProjectSchema.safeParse({title:"x"})     -> OK { title: "x" }
updateAnnouncementSchema.safeParse({title:"x"})-> OK { title: "x" }
```

And the control, proving the defect is still real in this zod version and that
the fix is not decorative:

```
z.object({ pinned: z.boolean().default(false), title: z.string().optional() })
  .partial()
  .safeParse({})
  -> OK { pinned: false }        // ← .partial() does NOT suppress .default()
```

So: **still true, verified empirically, not merely commented.** The mechanism is
that `projectFields` / `announcementFields` carry no `.default()`, and the
create schemas re-declare the defaulted keys on top
(`project.validation.ts:38-39`, `announcement.validation.ts:30`). If anyone ever
moves a `.default()` back into the shared shape, `PATCH {}` silently becomes a
200 that resets `status`/`progress`/`pinned`. Live regression guards:
`projects.test.ts:276-287` and `announcements.test.ts:209-222`.

**What PATCH can and cannot clear.** Only `coverUploadId` is nullable. Verified:

```
PATCH {coverUploadId: null}  -> OK   (detaches, see §6)
PATCH {description: null}    -> FAIL expected string, received null
PATCH {description: ""}      -> OK   (writes an empty string, not null)
PATCH {customerId: null}     -> FAIL expected string, received null
PATCH {startDate: null}      -> FAIL expected string, received null
PATCH {isPublished: true}    -> FAIL Unrecognized key: "isPublished"
PATCH {progress: 0}          -> OK   (0 is a real value, not "empty")
```

So **there is no way to detach a customer, clear a start/due date, or unset a
description back to `null` once set.** The best available is `description: ""`,
which comes back on the wire as `""` — not `null`, because `toProjectResponse`
uses `?? null`, which only catches `null`/`undefined`
(`project.actions.ts:30`). A UI that renders `description == null ? placeholder
: description` will show an empty box, not the placeholder.

**Omitted keys are not written.** `updateProjectForOrg` builds the update object
with explicit `undefined` for omitted `customerId`/`startDate`/`dueDate`
(`project.service.ts:166-172`). Mongoose strips `undefined` paths from the cast
update — verified by casting the real query against the real model without
executing it:

```
service builds: { title: "New", customerId: undefined, startDate: undefined, dueDate: undefined }
mongoose sends: { "title": "New" }
and with a null: { "title": "X", "cover": null }     // null DOES get written
```

That this is a `$set` and not a document replacement is proven on the wire by
`announcements.test.ts:118-127`: a PATCH of `{title, pinned}` leaves `createdBy`
intact.

`isPublished`, `publishedAt` and `shareTokenHash` are **not** writable through
PATCH — they are `.strict()`-rejected, and the only writer is
`setProjectPublishState` (`project.actions.ts:114-124`).

### 1.4 `POST /projects/:id/updates` — body schema

`createProjectUpdateSchema` (`project.validation.ts:64-69`):

```ts
z.object({
  body:     z.string().trim().min(1).max(5000),                 // REQUIRED
  progress: z.number().int().min(0).max(100).optional(),        // no default
}).strict()
```

`progress: null` is a 422 (`expected number, received null`) — omit the key
instead.

### 1.5 `Project` response shape

`ProjectResponse` / `toProjectResponse` (`project.actions.ts:4-19,27-44`).
Identical on list, get, create and patch.

```jsonc
{
  "id":          "68b0…",            // string, wire id — NOT _id
  "title":       "Website redesign",
  "description": "…" | null,          // "" is possible, see §1.3
  "customerId":  "68b0…" | null,      // BARE ID — never populated
  "status":      "planned" | "in_progress" | "on_hold" | "completed" | "cancelled",
  "progress":    0,                   // integer 0..100
  "startDate":   "2026-01-01T00:00:00.000Z" | null,
  "dueDate":     "2026-03-01T00:00:00.000Z" | null,
  "isPublished": false,
  "publishedAt": "2026-09-10T…Z" | null,
  "cover":       { "uploadId": "68b0…", "url": "https://…", "thumbUrl": "https://…" } | null,
  "createdBy":   "68b0…",            // BARE **MEMBER** ID — never populated, never a User id
  "createdAt":   "2026-09-10T…Z",
  "updatedAt":   "2026-09-10T…Z"
}
```

**Nothing is populated.** `customerId` is a bare id with no name; `createdBy` is
a bare **Member** id with no name and no `author` object — this is the exact
opposite of the announcement mapper, which does populate (§2.4). A project list
UI that needs a customer name or an author name must fetch them separately.

`createdBy` comes from `member._id` (`project.controller.ts:36`), so it will
**not** match the `id` a UI holds from `/auth/me` — compare against the caller's
`member.id`.

`shareTokenHash` is absent by construction — there is no `shareToken` field on
the model at all (`project.model.ts:31`), and `toProjectResponse` never reads
the hash (`project.actions.ts:21-26`). Proven on the wire by
`projects.test.ts:98-111`.

### 1.6 `ProjectUpdate` response shape

`ProjectUpdateResponse` / `toProjectUpdateResponse`
(`project-update.actions.ts:4-22`):

```jsonc
{
  "id":        "68b0…",
  "projectId": "68b0…",
  "body":      "Framing done",
  "progress":  40 | null,      // null when the update carried no progress
  "createdBy": "68b0…",        // BARE Member id, never populated
  "createdAt": "2026-09-10T…Z"
}
```

**There is no `updatedAt`** — the model sets `timestamps: { createdAt: true,
updatedAt: false }` because an update, once posted, is never edited
(`project-update.model.ts:25-26`). There is no PATCH route for one.

---

## 2. Announcements — the five routes

| # | Method | Path | Permission | Success |
|---|---|---|---|---|
| 1 | GET | `/announcements` | `announcements:view` | 200 `{data: Announcement[], meta}` |
| 2 | POST | `/announcements` | `announcements:create` | 201 `{data: Announcement}` |
| 3 | GET | `/announcements/:id` | `announcements:view` | 200 `{data: Announcement}` |
| 4 | PATCH | `/announcements/:id` | `announcements:update` | 200 `{data: Announcement}` |
| 5 | DELETE | `/announcements/:id` | `announcements:delete` | **204, empty** |

`announcement.route.ts:28,37,46,57,66`.

### 2.1 `GET /announcements` — query schema

`listAnnouncementsQuerySchema` (`announcement.validation.ts:66`):

```ts
z.object({ ...paginationQuerySchema.shape }).strict()   // page, limit — that is all
```

**`page` and `limit` are the only two query params in the entire feature.** No
search, no `pinned` filter, no author filter, no date filter, no sort param.
Verified:

```
listAnnouncementsQuerySchema.parse({})            -> { page: 1, limit: 20 }
listAnnouncementsQuerySchema.parse({search:"x"})  -> FAIL Unrecognized key: "search"
```

Defaults: `page` -> `1`, `limit` -> `20` (`common.validation.ts:28-29`). Those
are the only two `.default()`s reachable from the list route.

### 2.2 `POST /announcements` — body schema

`createAnnouncementSchema` (`announcement.validation.ts:27-33`):

```ts
z.object({
  title:         z.string().trim().min(1).max(150),   // REQUIRED
  body:          z.string().trim().min(1).max(5000),  // REQUIRED, min 1 — unlike project.description
  pinned:        z.boolean().default(false),          // ← the ONLY .default() in this file
  coverUploadId: objectIdSchema.nullable().optional(),
}).strict()
```

Verified: `createAnnouncementSchema.parse({title:"T", body:"B"})` ->
`{ title:"T", body:"B", pinned:false }`. `body: ""` is a 422.

### 2.3 `PATCH /announcements/:id`

`updateAnnouncementSchema` (`announcement.validation.ts:45-51`) — same
construction and same verified `{}` -> 422 behaviour as §1.3. `pinned: false` is
a valid, non-empty update (`false` is not `undefined`); `pinned: undefined` is
not.

Editing is **permission-based, not author-based** — any member holding
`announcements:update` may edit any announcement, and there is deliberately no
`createdBy` check (`announcement.service.ts:142-146`, route comment
`announcement.route.ts:55-56`). Editing does **not** reassign authorship
(`announcements.test.ts:125-127`).

### 2.4 `Announcement` response shape

`AnnouncementResponse` / `toAnnouncementResponse`
(`announcement.actions.ts:28-38,46-72`):

```jsonc
{
  "id":        "68b0…",
  "title":     "Holiday hours",
  "body":      "We close early on Friday.",
  "pinned":    false,
  "cover":     { "uploadId": "68b0…", "url": "https://…", "thumbUrl": "https://…" } | null,
  "createdBy": "68b0…",                              // Member id
  "author":    { "id": "68b0…", "name": "Amina" },   // ← POPULATED
  "createdAt": "2026-09-10T…Z",
  "updatedAt": "2026-09-10T…Z"
}
```

**Announcements are the one shape in these two features that comes back
populated.** Every read populates `createdBy` -> `Member.userId` -> `User.name`
in one hop (`AUTHOR_POPULATE`, `announcement.actions.ts:17-21`, applied at
`:80,103,112,124`).

`createdBy` and `author.id` are **always the same string** — both are
`createdBy?.id ?? ""` (`announcement.actions.ts:52,67-68`). `author.id` is a
**Member** id, and `author.name` is the **User's** name. Proven by
`announcements.test.ts:75`: `expect(author).toEqual({ id: member.id, name: user.name })`.

The fallback name is the literal string **`"Removed member"`**
(`announcement.actions.ts:53`), which fires only when the `User` row is gone
(account deletion) — not merely when the member was removed from the business
(`announcement.actions.ts:12-15`). If `createdBy` fails to populate entirely,
`createdBy` and `author.id` are both `""` — an empty string, not `null`.

There is **no** `authorId` key, and no `author` object anywhere in the project
shapes.

### 2.5 What an announcement does NOT have

Checked against the model (`announcement.model.ts:13-25`) and both validators:

- **No publish/draft state.** Every announcement is live the moment it is
  created. There is no `status`, `published`, `publishedAt` or `visibility`.
- **No audience field.** No `roles`, `audience`, `segment` or `memberIds` —
  every announcement is visible to every member holding `announcements:view`,
  which is all three presets (§5).
- **No expiry or scheduling.** No `expiresAt`, `startsAt`, `scheduledFor`.
- **No read/seen tracking**, no acknowledgements, no reaction or comment model.
- **No soft delete.** `deleteAnnouncementInOrganization` is a hard
  `findOneAndDelete` (`announcement.actions.ts:126-131`), proven by
  `announcements.test.ts:166-182` (delete then get is 404).

`pinned` is the only state flag that exists.

### 2.6 Ordering

`{ pinned: -1, createdAt: -1, _id: -1 }` (`announcement.actions.ts:100`), with a
matching index (`announcement.model.ts:41`). Pinned first, then newest, with
`_id` as the tiebreak for same-millisecond creation.

**The sort is applied before pagination**, so pinned items occupy the head of
page 1 and push older items off the tail — a heavily-pinned org can push
recent-but-unpinned announcements onto page 2. There is **no cap on how many may
be pinned** and no server-side "unpin the previous one" behaviour.

Proven by `announcements.test.ts:80-99`.

---

## 3. The share-link model

This is the one route in the product where a mistake is a real incident. Read
this section rather than inferring it.

### 3.1 How the token is generated and stored

```ts
generateToken = () => randomBytes(32).toString("hex")      // lib/tokens.ts:4
hashToken    = t => createHash("sha256").update(t).digest("hex")   // lib/tokens.ts:11-12
```

- The plain token is **64 lowercase hex characters** (32 bytes, 256 bits).
- Only the **SHA-256 hash** is persisted, on `Project.shareTokenHash`
  (`project.model.ts:31,56`). There is no `shareToken` field on the model at all.
- A unique **partial** index on `shareTokenHash`, filtered to
  `{ $exists: true }`, guarantees no two projects can collide and that never-
  published projects never touch the index (`project.model.ts:70-73`).
- `SHARE_TOKEN_REGEX = /^[0-9a-f]{64}$/` (`project.validation.ts:85`) —
  **lowercase only**. A correctly-hex but upper-cased token is rejected
  (verified: `SHARE_TOKEN_REGEX.test("A".repeat(64)) === false`). Do not
  normalise case, do not `toUpperCase()` anywhere on the path.

Proven on the wire and in the DB by `public-link.test.ts:56-64`: the response
token matches `/^[0-9a-f]{64}$/`, the stored `shareTokenHash` matches the same
shape, and the stored document has no `shareToken` key.

### 3.2 What each of the three actions does

| | `publish` | `unpublish` | `regenerate-link` |
|---|---|---|---|
| source | `project.service.ts:325-349` | `:353-360` | `:365-384` |
| mints a new token | **only if `shareTokenHash` is absent** | never | **always** |
| writes `shareTokenHash` | reuses the existing one if present | untouched | overwritten |
| sets `isPublished` | `true` | `false` | **`true`** |
| sets `publishedAt` | `new Date()` | untouched | `new Date()` |
| 409 if already published | **yes, `ALREADY_PUBLISHED`** | no | **no** |
| works on a never-published project | yes | yes (no-op, 200) | **yes — publishes it** |
| returns the plain token | only on the first publish | n/a | always |

Response bodies:

```jsonc
// POST /projects/:id/publish   (200, message "Project published")
{ "shareToken": "a3f…64hex" | null, "isPublished": true, "publishedAt": "2026-09-10T…Z" | null }

// POST /projects/:id/unpublish (200, message "Project unpublished")
{ "isPublished": false }        // ← ONLY this key. No shareToken, no publishedAt.

// POST /projects/:id/regenerate-link (200, message "Project share link regenerated")
{ "shareToken": "b71…64hex", "isPublished": true, "publishedAt": "2026-09-10T…Z" }
```

**`shareToken` is `null` on a re-publish.** After `unpublish` -> `publish`, the
project already has a hash, so `plainToken` is never assigned and the response
carries `shareToken: null` (`project.service.ts:333-338,348`). The plain token was
never stored, so the server genuinely cannot re-issue it. **The old link still
works** — but the frontend can only show it if it kept the token from the
original publish. If it did not, the only way to obtain a usable URL again is
`regenerate-link`, which invalidates the one clients already hold.

This is **source-only, untested**. `public-link.test.ts:132-136` republishes and
asserts only `status === 200`, then uses the *original* token variable — it never
inspects `republish.body.data.shareToken`. Treat it as verified by reading, not
by CI.

`publishedAt` is refreshed on **every** publish and regenerate
(`project.service.ts:340,374`), so it means "last published at", not "first
published at". `unpublish` leaves it stale and non-null.

None of the three is transactional — `setProjectPublishState` takes no session
(`project.actions.ts:116-124`). They are single-document
`findOneAndUpdate`s, which is atomic enough for their purpose but means there is
no rollback pairing with anything else.

### 3.3 Is an unpublished project's old token dead immediately?

**Yes, immediately and completely.** The public lookup filters on both fields in
one query:

```ts
// project.actions.ts:130-131
export const findPublishedProjectByShareTokenHash = (shareTokenHash: string) =>
  Project.findOne({ shareTokenHash, isPublished: true });
```

No cache, no TTL, no grace period. The moment `isPublished` flips to `false`,
that one query stops matching and the token 404s. Proven by
`public-link.test.ts:126-130`.

And it is reversible: publishing again without regenerating restores the exact
same link, because the hash was never touched
(`project.service.ts:351-352`; proven `public-link.test.ts:132-136`).

`regenerate-link` kills the old token just as immediately, by overwriting the
hash (`project.service.ts:362-364`; proven `public-link.test.ts:141-166`).

### 3.4 `GET /public/projects/:token` — exactly what an anonymous visitor gets

`public.controller.ts:14-26` -> `public-project.service.ts:35-65`. Full body:

```jsonc
{
  "success": true,
  "message": "Project fetched",
  "data": {
    "business": {
      "name": "Hodan Hardware",          // organization.name, or "" if the org row is gone
      "logo": "https://…/logo.webp" | null
    },
    "project": {
      "title":       "Storefront build",
      "description": "New signage and paint" | null,
      "status":      "in_progress",
      "progress":    40,
      "startDate":   "2026-01-01T00:00:00.000Z" | null,
      "dueDate":     "2026-03-01T00:00:00.000Z" | null,
      "updatedAt":   "2026-09-10T…Z",
      "cover":       { "url": "https://…", "thumbUrl": "https://…" } | null
    },
    "updates": [
      { "body": "Framing done", "progress": 40 | null, "createdAt": "2026-09-10T…Z" }
    ]
  }
}
```

Every optional field is normalised to `null` rather than left `undefined`
(`public-project.service.ts:30-33`), so the key set is identical on every 200
regardless of which fields the project has set. The three key sets are asserted
exactly, with `Object.keys().sort()`, at all three levels by
`public-link.test.ts:98-105` — that test is the regression guard against anyone
widening this payload.

Response header: **`Cache-Control: no-store`**, set unconditionally at the very
top of the controller so it lands on the 404 too (`public.controller.ts:16-17`;
asserted `public-link.test.ts:95`). See §3.7 for the two responses that miss it.

### 3.5 What is NOT exposed publicly — be precise

Compared against `ProjectResponse` (`project.actions.ts:4-19`) and
`ProjectUpdateResponse` (`project-update.actions.ts:4-11`), the public payload
drops:

**From the project:** `id`, `organizationId`, `customerId` (and any customer
name, phone or address — the Customer collection is never queried on this path),
`isPublished`, `publishedAt`, `createdAt`, `createdBy`, `shareTokenHash`, and
`cover.uploadId`. The public cover is `{ url, thumbUrl }` only
(`public-project.service.ts:58`).

**From each update:** `id`, `projectId`, `createdBy`. A public update is
`{ body, progress, createdAt }` only (`public-project.service.ts:60-64`).

**From the organization:** everything except `name` and `logo`. No id, slug,
currency, phone, address, email, plan or status
(`public-project.service.ts:46-49`).

**No member or user names appear anywhere on this route.** No `author` object,
no `createdBy`. Contrast §2.4, where announcements do carry author names — that
mapper is never reachable from the public route.

Three genuine residual exposures a reviewer should know about, none of them
bugs in the whitelist but all of them real:

1. **`project.updatedAt` is public.** Any internal PATCH — retitling, editing a
   description, nudging progress — moves it, and an anonymous poller can see the
   timing of internal edits. Note it is `updatedAt`, not `createdAt`: the
   project's age is not exposed.
2. **The cover and logo URLs embed the organization's ObjectId in plaintext.**
   Keys are built as `org/<organizationId>/<purpose>/<32-hex>.webp`
   (`upload.service.ts:124-126`), and `publicUrl` is pure string construction
   over that key (`storage.ts:85`). So `data.project.cover.url` leaks the
   organizationId and the literal segment `project`, and `data.business.logo`
   leaks the same organizationId. The payload's own comment claims "no ids"
   (`public-project.service.ts:30-32`) — that holds for JSON keys, not for the
   URL strings.
3. **Those URLs are permanently public and survive unpublishing.** Storage is
   public-read with unguessable keys and **no signed URLs**
   (`storage.ts:27-28`). Unpublishing revokes the JSON but not an image URL
   anyone already saved. Only replacing or clearing the cover deletes the object
   (§6).

One authorization gap worth stating plainly: **`findPublishedProjectByShareTokenHash`
does not check the organization's status** (`project.actions.ts:126-131`).
`requireMember` blocks members of a suspended organization
(`auth.middleware.ts:142`), but a suspended organization's published project
remains publicly reachable. If the org row is missing entirely, the page still
renders 200 with `business.name: ""` rather than 404
(`public-project.service.ts:46-47`). Neither is covered by a test.

### 3.6 What a member sees that a visitor does not

A member with `projects:view` calling `GET /projects/:id` additionally gets:
`id`, `customerId`, `isPublished`, `publishedAt`, `createdBy`, `createdAt`, and
`cover.uploadId` (§1.5). A member with `projects:view` calling
`GET /projects/:id/updates` gets each update's `id`, `projectId` and `createdBy`,
**paginated** (§4).

A member does **not** get the share token back from any read endpoint. `GET
/projects/:id` exposes `isPublished` and `publishedAt` but no token and no hash
(`project.actions.ts:21-26`; proven `projects.test.ts:98-111`). §7 of the traps
covers the consequence.

### 3.7 The 404 / no-oracle property, and its one hole

Malformed, unknown, unpublished and since-regenerated tokens all converge on the
identical response:

```jsonc
// 404
{ "success": false, "message": "Project not found", "code": "NOT_FOUND" }
```

Two independent mechanisms produce it. A token failing `SHARE_TOKEN_REGEX` is
mapped to `NotFoundError("Project")` **in the controller**, before any DB read
(`public.controller.ts:20-22`), specifically so a shape mismatch is not a 422
that would tell a prober the endpoint exists. Everything else fails the single
`{ shareTokenHash, isPublished: true }` lookup and raises the same error
(`public-project.service.ts:38`).

`public-link.test.ts:168-191` asserts the bodies are byte-identical with
`toEqual` across a wrong token, a malformed token (`abc`) and a never-issued one
(`"f".repeat(64)`).

**The hole: a token longer than 128 characters is a 422, not a 404.** The route's
own `validate()` bounds `token` to `z.string().max(128)`
(`public.route.ts:19`), and that runs before the controller, so an over-long
segment produces:

```jsonc
{ "success": false, "message": "Validation failed",
  "errors": { "token": "Too big: expected string to have <=128 characters" },
  "code": "VALIDATION_ERROR" }
```

That is a distinguishable response on a route whose whole design goal is that
none exist. It is minor (it discloses nothing beyond "there is a length bound"),
but the file's "malformed input is never an oracle" comment
(`public.route.ts:13-15`) is not literally true. Untested.

Also: the 422 above and the 429 below both **lack `Cache-Control: no-store`**,
because the header is set inside the controller (`public.controller.ts:17`) and
neither path reaches it.

### 3.8 Rate limiting

`rateLimit({ name: "public-project", windowMs: 60_000, max: 60 })`
(`public.route.ts:18`), an in-memory fixed window keyed on `req.ip`
(`rate-limit.middleware.ts:109,140-143`).

- **60 requests per 60 seconds per IP.** The 61st is a 429 with a `Retry-After`
  header in whole seconds and body message `"Too many attempts. Try again in N
  seconds."`, code `TOO_MANY_REQUESTS` (`rate-limit.middleware.ts:161-167`).
  Proven by `public-link.test.ts:193-205`.
- The bucket name is `"public-project"` with no token in the key, so **all public
  project links share one allowance per IP**. A shared office or mobile-carrier
  NAT viewing many project pages will exhaust it collectively.
- The limiter runs **before** validation, so even a malformed token burns
  allowance.
- State is per-process and in memory; a restart resets every counter
  (`rate-limit.middleware.ts:41-51`).

---

## 4. Project updates

### 4.1 Shape and ordering

Shape: §1.6. Ordering for members: `{ createdAt: -1, _id: -1 }`
(`project-update.actions.ts:40`) — **newest first**, `_id` tiebreak. Paginated
with `page`/`limit`, defaults `1`/`20`, `.strict()`
(`listProjectUpdatesQuerySchema`, `project.validation.ts:62`).

`GET /projects/:id/updates` checks the project exists first and 404s
`Project not found` before listing (`project.service.ts:246-247`) — so an unknown
project id gives 404, not an empty list.

The count and the page are read concurrently against the same filter
(`project.service.ts:249-252`), so `meta.total` and `data` always describe the
same set.

### 4.2 Posting an update can move the project's progress

`createProjectUpdateForOrg` (`project.service.ts:268-303`) runs inside a
transaction: it re-checks the project exists (404 inside the transaction,
`:277-278`), inserts the update, and **when `progress` was supplied, writes it
onto the project too** (`:291-294`).

So `POST /projects/:id/updates { body, progress: 40 }` has a **side effect on the
project row** — a projects list already in memory is stale afterwards. An update
without `progress` leaves the project's progress untouched and comes back with
`progress: null`. Both halves proven by `projects.test.ts:135-163`.

There is no `PATCH .../updates/:updateId` — updates are immutable
(`project-update.model.ts:25-26`).

### 4.3 Do they appear on the public page?

**Yes, all of them, automatically, with no per-update visibility flag.** The
moment a project is published, every update ever posted against it is public.
There is no `internal`/`private` field on `IProjectUpdate`
(`project-update.model.ts:8-15`) and no filter on the public query
(`project-update.actions.ts:69-73`).

Two differences from the member view:

- **Capped at 100, not paginated.** `MAX_PUBLIC_UPDATES = 100`
  (`public-project.service.ts:8`), passed as `.limit(100)`
  (`project-update.actions.ts:73`). A project with 150 updates shows the newest
  100 publicly and there is no way for a visitor to page further.
- Each is reduced to `{ body, progress, createdAt }` — no id, no author.

Same newest-first ordering (`project-update.actions.ts:73`), proven end-to-end by
`public-link.test.ts:109`.

### 4.4 What deleting one does

`DELETE /projects/:id/updates/:updateId` (`projects:update`) ->
`deleteProjectUpdateForOrg` (`project.service.ts:305-315`):

1. Loads the project; 404 `Project not found` if unknown or cross-tenant.
2. Deletes scoped by **organizationId AND projectId AND _id**
   (`project-update.actions.ts:52-57`); 404 `Project update not found` if the id
   belongs to a sibling project. Proven `projects.test.ts:165-193`.
3. Returns **204 with no body**.

**Deleting an update does not roll back the project's `progress`.** Nothing
recomputes it — if an update set progress to 40 and is then deleted, the project
stays at 40 (`project.service.ts:305-315` contains no progress logic). The
deletion is not transactional either (no session passed at `:313`).

It also disappears from the public page immediately, since the public read is a
live query.

**Deleting the project hard-deletes all of its updates** in the same transaction
(`project.service.ts:215-239`, cascade at `:225`), proven by
`projects.test.ts:195-215` (`countDocuments === 0` afterwards). There is no soft
delete and no undo.

---

## 5. Permissions

Catalog (`lib/permissions.ts:55-64`):

```
announcements:view, announcements:create, announcements:update, announcements:delete
projects:view, projects:create, projects:update, projects:delete, projects:publish
uploads:create
```

`projects:publish` is a single permission covering **all three** of publish,
unpublish and regenerate-link (`project.route.ts:118,127,136`). There is no
separate unpublish or regenerate permission.

### Presets

**There is no `PRESET_SELLER` symbol in this codebase.** `grep -rn PRESET_SELLER
src tests` returns nothing. The presets live in the array
`PRESET_ROLES` (`lib/permissions.ts:107-137`); the Seller entry is the third
element, `name: "Seller"` (`:120-135`).

| preset | grant | `announcements:view`? | `projects:view`? |
|---|---|---|---|
| Owner | `[WILDCARD]` = `["*"]` (`:112`) | yes, via wildcard (`hasPermission`, `:98-99`) | yes |
| Manager | `ALL_PERMISSIONS` minus `organization:delete` (`:116`) | yes | yes |
| Seller | 13 enumerated permissions (`:121-135`) | **yes — `permissions.ts:133`** | **yes — `permissions.ts:134`** |

**So yes: `announcements:view` is held by every preset.** So is `projects:view`.

What a Seller does **not** hold: `announcements:create/update/delete`,
`projects:create/update/delete/publish`, and `uploads:create` — all absent from
the enumerated list. Proven on the wire: `announcements.test.ts:135-164` (Seller
gets 200 on list and get, 403 on create/patch/delete) and
`projects.test.ts:217-249` (same, plus 403 on publish).

Custom roles can hold any subset — the presets are seed data, not a constraint.
Do not gate UI on "is the user a Seller"; gate on the permission strings from
the session.

---

## 6. Cover images and uploads

Both features attach a cover the same way, through the shared attachment
service. There is no direct-upload-to-the-resource endpoint.

### 6.1 Step 1 — create the upload

`POST /api/v1/uploads`, permission **`uploads:create`** (`upload.route.ts:34-43`).

This route is a **recorded exception to the standard middleware order**
(`upload.route.ts:24-33`) — the multipart body does not exist until multer has
run, and the rate limiter is org-keyed so it needs the tenant resolved first:

```
requireAuth -> requireMember -> requirePermission(UPLOADS_CREATE)
  -> rateLimit({ name:"uploads", windowMs: 15*60_000, max: 100, keyBy:"organization" })
  -> singleImageUpload -> validate({ body: uploadBodySchema }) -> handler
```

- `multipart/form-data`, binary field named exactly **`file`**
  (`upload.middleware.ts:20`; a wrong field name is a 422
  `"Expected a single multipart file field named 'file'"`, `:27`).
- Limits: **10 MB, one file** (`upload.middleware.ts:6,8`); over the limit is a
  **413** `FILE_TOO_LARGE`.
- Text field **`purpose`**, a required enum: `"product" | "announcement" |
  "project" | "logo"` (`upload.validation.ts:10`), `.strict()`.
- 100 uploads per 15 minutes **per organization**, not per user
  (`upload.route.ts:39`).

201 body (`upload.actions.ts:9-32`):

```jsonc
{ "id": "68b0…", "purpose": "project", "url": "https://…", "thumbUrl": "https://…",
  "width": 1200, "height": 800, "size": 84213, "createdAt": "2026-09-10T…Z" }
```

Everything is re-encoded to **`image/webp`** server-side
(`upload.model.ts:27,46`); the client never influences the storage key
(`upload.service.ts:123-126`).

### 6.2 Step 2 — attach it

Send `coverUploadId: <upload.id>` on `POST /projects`, `PATCH /projects/:id`,
`POST /announcements` or `PATCH /announcements/:id`.

The purpose must match the target: **`"project"` for a project cover,
`"announcement"` for an announcement cover**
(`project.service.ts:67`, `announcement.service.ts:46`). A mismatch is a 409
`UPLOAD_PURPOSE_MISMATCH` (`attachments.service.ts:52-54`).

`coverUploadId` semantics (`project.validation.ts:31-32`,
`announcement.validation.ts:4-5`):

| value | meaning |
|---|---|
| omitted | leave the cover exactly as it is |
| an id | attach it; drop and **delete** the previous cover if different |
| `null` | detach and **delete** the current cover |

The two "keep" and "clear" cases are distinguished by
`coverUploadId === undefined` vs `=== null` in `resolveCover`
(`project.service.ts:57-63`, `announcement.service.ts:36-42`).

**On create, `coverUploadId: null` is accepted and silently ignored.** Both create
services guard with a truthiness check, `if (input.coverUploadId)`
(`project.service.ts:110`, `announcement.service.ts:83`), and the validator
accepts `null` (verified). No error, no cover — which is the right outcome, but
not an error the way a frontend might expect.

### 6.3 The attach-inside-the-transaction rule

This is a deliberate, documented invariant, and it is what the response
guarantees rest on:

1. **`attachUploads` runs INSIDE the caller's transaction**, with `session`
   required, not optional (`attachments.service.ts:36-68`, called at
   `project.service.ts:65-71` and `announcement.service.ts:44-50`, both within
   `dbSession.withTransaction`). A foreign, already-attached or wrong-purpose
   cover id therefore **rolls the whole resource write back** — you never get a
   coverless project left behind for a retrying client to duplicate
   (`announcement.service.ts:18-28`).
2. **`detachUploads` also runs inside the transaction** — it only clears
   `attachedTo`, never touching storage (`attachments.service.ts:70-88`).
3. **`releaseUploads` — the actual S3 + row delete — runs ONLY after the
   transaction commits**, never inside one, because an S3 delete cannot be rolled
   back (`attachments.service.ts:90-98`; call sites `project.service.ts:129,204,236-238`
   and `announcement.service.ts:107,182,209`, all after the `finally
   { endSession() }`).
4. Storage failures during release are **best effort**: logged as a warning, the
   row is kept for a later sweep, and the request still succeeds
   (`attachments.service.ts:108-122`).
5. All verification happens before any write, so a request failing on its third
   id leaves the first two untouched (`attachments.service.ts:31-34`).

Proven on the wire by `tests/integration/uploads/attach.test.ts:439-470`
(announcement) and `:471-497` (project): an already-attached cover id gives 409
`UPLOAD_ATTACHED` **and no row is created**.

`attach.test.ts:268-302` proves the announcement lifecycle end to end — create
with a cover (201, `cover` non-null), `PATCH { coverUploadId: null }` (200,
`cover` null, and `UploadModel.findById(uploadId)` is **null**, i.e. the row is
gone), and deleting an announcement with a cover releases it too.

Re-sending the **same** upload id to the **same** target is idempotent, so a
PATCH that resends the current cover does not 409
(`attachments.service.ts:29,62`).

Consequence for the UI: **replacing or clearing a cover permanently deletes the
old image from storage.** There is no "recently removed" gallery to restore from.

Note the create path with a cover does two writes — insert, then a second
`updateProjectById`/`updateAnnouncementInOrganization` carrying the cover
(`project.service.ts:119`, `announcement.service.ts:92-97`) — but both are inside
the one transaction, and the 201 body already carries the populated `cover`.

**Neither the projects nor the announcements test suite tests covers at all**
(`grep coverUploadId tests/integration/projects tests/integration/announcements`
returns nothing). All cover coverage lives in
`tests/integration/uploads/attach.test.ts`.

---

## 7. Error codes

Every code reachable from these seventeen routes, with its exact constant.

### Auth / permission (all seventeen authenticated routes)

| Status | `code` | `message` | Condition | Source |
|---|---|---|---|---|
| 401 | `UNAUTHORIZED` | `"Authentication required"` | no session cookie | `auth.middleware.ts:41`; `errors.ts:38-42` |
| 401 | `UNAUTHORIZED` | `"Your session has expired, please sign in again"` | unknown/expired session, or the user row is gone | `auth.middleware.ts:44,49` |
| 403 | `FORBIDDEN` | the ban reason, or `"This account has been banned"` | `user.status === "banned"` | `auth.middleware.ts:53` |
| 403 | `FORBIDDEN` | `"This account is suspended"` | `user.status === "suspended"` | `auth.middleware.ts:56` |
| 403 | `FORBIDDEN` | `"You do not belong to a business yet"` | no active Member row | `auth.middleware.ts:134` |
| 403 | `FORBIDDEN` | `"Your business could not be found"` | org row missing | `auth.middleware.ts:141` |
| 403 | `FORBIDDEN` | `"This business is suspended"` | `organization.status !== "active"` | `auth.middleware.ts:142` |
| 403 | `FORBIDDEN` | `"Your role could not be found"` | role row missing | `auth.middleware.ts:143` |
| 403 | `FORBIDDEN` | `"You do not have permission to do that"` | missing the route's permission | `auth.middleware.ts:168` |

All nine 403s share `code: "FORBIDDEN"` (`errors.ts:44-56`). **A missing
permission is not distinguishable from a suspended business by `code`** — only by
message text. `EMAIL_NOT_VERIFIED` is unreachable here (no route in either
feature uses `requireVerifiedEmail`).

### Domain — projects

| Status | `code` | `message` | Condition | Source |
|---|---|---|---|---|
| 404 | `NOT_FOUND` | `"Project not found"` | unknown or cross-tenant project id, on every route that takes `:id`, and inside publish/unpublish/regenerate | `project.service.ts:155,177,203,231,247,278,311,330,346,358,381` |
| 404 | `NOT_FOUND` | `"Project update not found"` | `updateId` not in **this** project | `project.service.ts:314` |
| 404 | `NOT_FOUND` | `"Customer not found"` | `customerId` unknown or cross-tenant, on create **and** patch | `project.service.ts:40` (via `:88,164`) |
| 409 | `ALREADY_PUBLISHED` | `"Project is already published"` | `POST /publish` on an already-published project | `project.service.ts:331` |
| 404 | `NOT_FOUND` | `"Project not found"` | **public route**: malformed, unknown, unpublished or regenerated token | `public.controller.ts:21`; `public-project.service.ts:38` |
| 429 | `TOO_MANY_REQUESTS` | `"Too many attempts. Try again in N seconds."` | >60 requests/60s per IP on the public route | `rate-limit.middleware.ts:167` |

`ALREADY_PUBLISHED` is the **only** domain-specific 409 in the projects feature.
There is deliberately **no** `NOT_PUBLISHED`, `ALREADY_UNPUBLISHED` or
`NO_SHARE_LINK` code — unpublish and regenerate never conflict.

### Domain — announcements

| Status | `code` | `message` | Condition | Source |
|---|---|---|---|---|
| 404 | `NOT_FOUND` | `"Announcement not found"` | unknown or cross-tenant id on get/patch/delete | `announcement.service.ts:138,153,181,194,200` |

That is the complete list. Announcements have **no** domain-specific 409 and no
conflict conditions at all.

### Shared — cover attachment (reachable from all four create/update routes)

| Status | `code` | `message` | Source |
|---|---|---|---|
| 404 | `NOT_FOUND` | `"Upload not found"` | `attachments.service.ts:51` |
| 409 | `UPLOAD_PURPOSE_MISMATCH` | `"Upload purpose does not match this resource"` | `attachments.service.ts:53` |
| 409 | `UPLOAD_ATTACHED` | `"Upload is already attached to another resource"` | `attachments.service.ts:56` |

### Validation

| Status | `code` | Body | Source |
|---|---|---|---|
| 422 | `VALIDATION_ERROR` | `{ success:false, message:"Validation failed", errors:{ "<dotted.path>": "<message>" }, code:"VALIDATION_ERROR" }` | `validate.middleware.ts:80`; `errors.ts:110-118`; `error.middleware.ts:80-89` |

Field keys are dotted paths from zod, first-issue-wins per key
(`error.middleware.ts:9-16`). On a path colliding across two sources the second
is namespaced `body.x` / `params.x` / `query.x`
(`validate.middleware.ts:20-28`). A body-level refine failure (the empty-PATCH
case) has an empty path and lands under the key **`"_"`**
(`error.middleware.ts:12`) with message `"At least one field must be provided"`.

Every 422 from these routes shares `code: "VALIDATION_ERROR"` — as with sales,
**branch on `errors` keys, not on `code`**.

Also possible from the global handler but effectively unreachable here because
the validators cover every id (`error.middleware.ts:105-128`): 409 duplicate-key
(no unique index in either feature is client-reachable), 400 `"Invalid
identifier"` (CastError), 400 `"Malformed JSON in the request body"`, and 500
`"Something went wrong"`.

---

## 8. What the tests prove that source alone does not

`tests/integration/projects/public-link.test.ts`:

- **The public whitelist is enforced as an exact key set, not a superset.**
  `:98-105` asserts `Object.keys(...).sort()` at all three levels. Source alone
  shows an object literal; this makes widening the payload a CI failure.
- **The 404 bodies really are byte-identical** across a wrong token, `abc`, and
  `"f".repeat(64)` — `toEqual` on the whole body, `:184-188`. The no-oracle
  property is proven end-to-end, not just designed.
- **The stored document has no plain token.** `:62-64` reads the row directly and
  asserts `shareTokenHash` is 64-hex while `shareToken` is `undefined`.
- **Unpublish -> republish restores the same link.** `:114-139` is the only proof
  that the hash-reuse path works end to end (source shows the branch; the test
  shows the old token 404s while unpublished and 200s again after).
- **`Cache-Control: no-store` is actually on the wire** (`:95`).
- **`code` is serialized on a 409** — `again.body.code === "ALREADY_PUBLISHED"`
  (`:66-68`). Source shows `AppError.code`; only this proves it survives
  `errorResponse` onto the wire.
- **The 429 carries `Retry-After`** and fires on request 61 within one minute
  (`:193-205`).
- **A cookie-less caller genuinely gets 200** (`:207-223`) — cookies are cleared
  before the request, so this rules out an accidental auth dependency.

`tests/integration/projects/projects.test.ts`:

- `GET /projects/:id` contains neither `shareTokenHash` nor `shareToken` as a key
  (`:98-111`).
- Posting an update with `progress` moves the project's progress and one without
  leaves it, with `progress: null` on the wire in the second case (`:135-163`).
- Cross-project update deletion is 404 (`:165-193`).
- Deleting a project really removes its updates —
  `ProjectUpdateModel.countDocuments === 0` (`:195-215`).
- A cross-tenant `customerId` on create is 404, not 422 (`:78-96`).
- Seller: list/get 200, create/patch/delete/publish 403 (`:217-249`).
- **`PATCH {}` is 422** (`:276-287`) — the live guard on the `.partial()` defect.

`tests/integration/announcements/announcements.test.ts`:

- `author` is exactly `{ id: member.id, name: user.name }` — proving `author.id`
  is a **Member** id while `author.name` comes from the **User** (`:63-78`).
- Pinned-first-then-newest ordering with three rows (`:80-99`).
- A different Manager can get/patch/delete, **and `createdBy` is not reassigned**
  by the edit (`:101-133`) — which also proves the PATCH is a `$set`, not a
  document replacement.
- Delete is hard: get afterwards is 404 (`:166-182`).
- **`PATCH {}` is 422** (`:209-222`).

`tests/integration/uploads/attach.test.ts` (the only cover coverage anywhere):

- Announcement cover create -> `PATCH { coverUploadId: null }` -> the Upload row
  is **gone from the database**, and deleting an announcement with a cover
  releases it too (`:268-302`).
- Attach atomicity for both features: an already-attached cover id gives 409
  `UPLOAD_ATTACHED` **and leaves no row behind** (`:439-470` announcement,
  `:471-497` project).

**Not covered by any test** — treat these as read-verified only:

- `publish` after `unpublish` returning `shareToken: null`
  (`public-link.test.ts:132-136` checks only the status code).
- Any project cover happy path (create/patch/clear) — announcements have one,
  projects have only the 409 atomicity case.
- The >128-char token 422 (§3.7).
- A suspended or deleted organization's published project still serving 200.
- `description: ""` round-tripping as `""` rather than `null`.

---

## Top traps for a frontend developer

1. **The share token is shown once and is unrecoverable.** No read endpoint ever
   returns it — `GET /projects/:id` gives you `isPublished` and `publishedAt`
   but no token and no hash (`project.actions.ts:21-26,27-44`). Worse,
   `POST /publish` after an `unpublish` returns **`shareToken: null`**, because
   the hash is reused and the plain token was never stored
   (`project.service.ts:333-338,348`). So: **capture and persist the token from
   the publish/regenerate response immediately.** If it is lost, the only way
   back to a displayable URL is `regenerate-link`, which kills the link every
   existing client already has. A "Copy link" button that expects to re-read the
   token on page load will render an empty string forever.

2. **The public page exposes `updatedAt`, and the cover/logo URLs leak the
   organizationId.** The JSON whitelist is genuinely tight — no ids, no customer,
   no member names, no `isPublished`, no `createdAt`
   (`public-project.service.ts:45-65`, asserted `public-link.test.ts:98-105`) —
   but `project.updatedAt` is public and moves on every internal edit, and
   `cover.url` / `business.logo` are `org/<organizationId>/<purpose>/<hex>.webp`
   over a **public-read bucket with no signed URLs**
   (`upload.service.ts:124-126`, `storage.ts:27-28,85`). Those image URLs keep
   working after an unpublish. Do not tell a customer that unpublishing revokes
   everything.

3. **`POST /projects/:id/updates` mutates the project.** Supplying `progress`
   writes it onto the project row in the same transaction
   (`project.service.ts:291-294`), so any cached project object is stale the
   moment an update is posted. And **deleting that update does not roll the
   progress back** (`project.service.ts:305-315` has no progress logic) — a UI
   offering "undo" after deleting a progress update will silently lie.

4. **Nothing on a project is populated, but announcements are — and the two look
   deliberately similar.** `Project.createdBy` and `Project.customerId` are bare
   id strings (`project.actions.ts:31,41`); `Announcement` ships a populated
   `author: { id, name }` alongside `createdBy` (`announcement.actions.ts:67-68`).
   A shared "posted by" component written against the announcement shape will
   render `undefined` on projects. Both `createdBy` values are **Member** ids —
   they will not match the id a UI holds from `/auth/me`.

5. **`PATCH` cannot clear anything except the cover, and empty PATCH is a 422.**
   Only `coverUploadId` is nullable (`project.validation.ts:32`,
   `announcement.validation.ts:5`); `description: null`, `customerId: null` and
   `startDate: null` are all 422s, verified against the real schema. There is no
   way to detach a customer or clear a due date once set. Meanwhile `PATCH {}`
   is a deliberate 422 with the error under the key **`"_"`**, not a no-op 200
   (`project.validation.ts:54-56`, `announcements.test.ts:209-222`) — so a
   dirty-field form that submits `{}` when nothing changed will surface an error
   to the user. Filter to changed fields before sending, and remember `progress:
   0` and `pinned: false` are real values that must be sent, not treated as
   empty.

### Runners-up

6. `POST /publish` on an already-published project is **409 `ALREADY_PUBLISHED`**
   (`project.service.ts:331`), but `unpublish` and `regenerate-link` never
   conflict — `regenerate-link` on a never-published project **publishes it**
   as a side effect (`project.service.ts:376-380`). And `unpublish` returns
   `{ isPublished: false }` **only** — no `publishedAt`, no `shareToken` — so do
   not destructure the publish response type from it.

7. Dates on `POST`/`PATCH /projects` need a full ISO datetime **with `Z`**;
   `"2026-01-01"` and `"2026-01-01T00:00:00+02:00"` are both 422s (verified).

8. `GET /projects` and `GET /announcements` are `{ data, meta }`, both
   `.strict()` with **no search and no sort param**. `?search=` is a 422, not an
   ignored key. Announcements have exactly two query params in the whole feature.

9. The public share token is **lowercase hex only**
   (`/^[0-9a-f]{64}$/`, `project.validation.ts:85`) and a 64-char uppercase
   variant 404s. Never normalise case on the token.

10. The public route's rate limit is **60/min per IP shared across every project
    link** (`public.route.ts:18`), and 429s carry `Retry-After` but **not**
    `Cache-Control: no-store` (the header is set in the controller, which a 429
    never reaches). A polling public page will exhaust the bucket for every other
    visitor behind the same NAT.

11. Everything in both features is a **hard delete** — projects cascade to their
    updates (`project.service.ts:225`), announcements have no removed status
    (`announcement.actions.ts:126`). There is no restore path, and clearing a
    cover permanently deletes the image from storage.

12. Announcement editing and deletion are **permission-based, not author-based**
    (`announcement.service.ts:142-146`). Do not hide the edit button on "not your
    post" — anyone with `announcements:update` can edit anyone's, and doing so
    does not change `createdBy`.
