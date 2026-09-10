# Slice 5 — announcements, end to end

`features/announcements/` — types, keys, schema, service, three hook files, five components — plus
`app/(app)/announcements/page.tsx` and `app/(app)/announcements/[id]/page.tsx`. Written against
`docs/contracts/projects-announcements.md` §2 and §6, and against artboard `2m` in
`docs/design/TradeOs-UI.dc.html`.

Verified 2026-09-10: `bunx tsc --noEmit` clean over this slice, `bunx biome check` clean over these
files, `bunx vitest run features/announcements` 96 tests / 8 files green, full suite 769 tests /
82 files green.

---

## The contract is correct for this feature, and the cover fits — so the cover was built

**What:** The task allowed leaving the cover image out if attaching one did not fit cleanly. It
fits. `<ImagePicker purpose="announcement" max={1}>` already exists in `features/uploads/`, the
attach is a single `coverUploadId` field on the same create and update bodies, and the announcement
lifecycle is the *only* cover path in the backend that has an end-to-end test
(`tests/integration/uploads/attach.test.ts:268-302` — create with a cover, `PATCH { coverUploadId:
null }`, and the `Upload` row is gone from the database).

**Evidence:** three things had to hold and all three do.

1. **The attach is inside the write's own transaction** (`attachments.service.ts:36-68`, called
   within `dbSession.withTransaction` at `announcement.service.ts:44-50`), so a bad upload id rolls
   the whole announcement back. There is no half-saved state for the form to reason about — the
   three refusals (`NOT_FOUND` "Upload not found", 409 `UPLOAD_PURPOSE_MISMATCH`, 409
   `UPLOAD_ATTACHED`) all mean *nothing happened*, which is why the form can surface them at the
   image control and let the user retry from there.
2. **A Seller cannot upload, and also cannot create.** The Seller preset holds `announcements:view`
   and none of `announcements:create/update/delete` or `uploads:create` (contract §5). So the
   picker's audience is a subset of the form's audience by construction and there is no role for
   whom the form is reachable but the picker is not — except a *custom* role holding
   `announcements:create` without `uploads:create`, which is why the picker is still wrapped in a
   `useCan(PERMISSIONS.UPLOADS_CREATE)` rather than assumed.
3. **`purpose` must be `"announcement"`**, not `"project"` or `"product"`
   (`announcement.service.ts:46`); a mismatch is a 409. The picker takes `purpose` as a prop and it
   is passed literally.

**So what:** the one thing worth saying out loud in the UI, and the reason
`announcement-form-sheet.tsx` carries a sentence about it: **replacing or clearing a cover
permanently deletes the old image from storage.** `releaseUploads` is a real S3 delete plus a row
delete, run after the transaction commits (`attachments.service.ts:90-98`). There is no
recently-removed gallery. "Remove" is destruction here, not unlinking.

---

## Nothing in artboard `2m` is undeliverable — the one gap is a control the artboard implies

**What:** Everything the announcements half of `2m` draws exists on the wire. Cover: yes.
Pinned marker on a card and the `Pinned` eyebrow on the reading view: yes, `pinned` is the only
state flag an announcement has. Author name and avatar initials on the byline: **yes, without a
second request** — this is the one shape in the projects/announcements pair that comes back
populated. Relative timestamp: yes. Edit and Unpin as text controls on the byline: yes, both are
`PATCH`.

**What is missing is a search box**, which the artboard does not draw but every other list screen in
this product has. It cannot be built: `listAnnouncementsQuerySchema` is
`z.object({ ...paginationQuerySchema.shape }).strict()` — `page` and `limit` and nothing else, so
`?search=x` is a 422 `Unrecognized key`, not an ignored param (contract §2.1, verified against the
real schema). A client-side filter over one page of twenty would confidently lie about the pages it
cannot see. The feed therefore has pagination and no filters at all, and
`announcements-page.tsx` says why at the parser.

**So what:** if a business ever accumulates enough notices for this to bite, the fix is a backend
`search` param, not a frontend workaround.

---

## `author.id` is a **Member** id, and the name comes from the **User** — they are different rows

**What:** `author` is `{ id, name }` where `id === createdBy` (both are `createdBy?.id ?? ""`,
`announcement.actions.ts:52,67-68`) and `name` is the populated `Member.userId.name`. So the id
identifies a *membership*, and the name identifies a *person*.

**Evidence:** `announcements.test.ts:75` asserts `expect(author).toEqual({ id: member.id, name:
user.name })` — the test names both rows explicitly, which is the only place this is unambiguous.

**So what:** two consequences encoded in `types.ts`.

- **Do not compare `author.id` against the id from `/auth/me`.** That is a User id. The comparable
  value is the session's `member.id`.
- **The degenerate values are empty strings, not `null`.** `name` is the literal `"Removed member"`
  when the User row is gone (account deletion — *not* merely when the member left the business,
  `announcement.actions.ts:12-15`), and if `createdBy` fails to populate at all then both `createdBy`
  and `author.id` are `""`. So `author.id ?? fallback` never fires and `author.name[0]` renders
  `undefined`. `initialsOf` in `announcement-detail.tsx` guards this and has a test for it.

---

## `PATCH {}` is a 422 keyed `"_"`, and that shaped three files

**What:** The contract's trap 5. An object-level zod `.refine` has an empty path, and
`zodToFieldErrors` keys an empty path as `"_"` (`error.middleware.ts:12`). So an empty patch is not
a no-op 200 — it is a 422 whose message, "At least one field must be provided", arrives under a
field name no form has a control for.

**So what:** three defences, in the order they fire.

1. **`announcementPatch(original, next)` in `schemas/announcement.schema.ts` is the only sanctioned
   way to build a PATCH body.** It diffs, and returns `null` when nothing changed. The form treats
   `null` as "close the sheet", so an edit that touched nothing is never sent.
2. **`pinned: false` and `coverUploadId: null` survive the diff.** Both are real values — the unpin
   and the delete-the-image — and a truthiness filter over the diff (`if (next.pinned)`) would drop
   exactly the two updates that matter most. There are three separate tests on this one point,
   including one at the axios-adapter level asserting the falsy field is still on the wire.
3. **`FORM_LEVEL_ERROR_KEY` is exported and routed.** `ISSUE_FOR_FIELD` in the form sheet maps `"_"`
   to the form-level panel, so if the server ever raises it anyway the user reads a sentence instead
   of nothing.

The `.partial()`-keeps-defaults defect the contract verified is **still real in this zod version**
and the fix is still load-bearing. `schemas/announcement.schema.ts` mirrors the backend's
*arrangement*, not just its field list: `pinned`'s `.default(false)` lives on the create schema and
deliberately **not** on the shared `announcementFields` shape. There is a test asserting
`updateAnnouncementSchema.parse({ title: "New" })` has no `pinned` key — because if the default were
moved into the shared shape, a one-field patch would silently unpin the notice. No defensive echoing
was added, as instructed; the guard is a test, not runtime code.

---

## Pinning moves a row across pages, which is why nothing is optimistically patched

**What:** The list sort is `{ pinned: -1, createdAt: -1, _id: -1 }` and it is applied **before**
pagination (`announcement.actions.ts:100`). Pinning a notice moves it to the head of page 1 and
pushes the oldest row on that page onto page 2. There is no cap on how many may be pinned and no
server-side "unpin the previous one".

**So what:** every mutation in `use-announcement-mutations.ts` invalidates
`announcementKeys.lists()`, pinning included. A `setQueryData` that flipped `pinned` in place would
leave the card exactly where it was and quietly disagree with the server about what page 2 contains.
Detail entries *are* seeded from create and patch responses, because those come from the same mapper
`GET /announcements/:id` uses — seeding those invents nothing.

Delete uses `removeQueries` on the detail key rather than `invalidateQueries`: invalidating would
refetch an id the server has just stopped serving and cache a 404 under it.

---

## The cross-feature edge: every write here invalidates the **upload gallery**

**What:** All three mutations invalidate `uploadKeys.lists()`. Attaching a cover moves an upload out
of the unattached set `<ImagePicker>` lists; replacing or clearing one deletes the old upload's row
outright; deleting an announcement releases its cover the same way.

**So what:** this is the kind of edge that is invisible until a user sees a picker still offering an
image that no longer exists, or hits the per-member pending-upload cap (5) with a stale count.
Nothing in `features/uploads` can know an announcement was written, so the write that caused it has
to say so — the same shape as `features/debts` invalidating `customerKeys.detail`.

---

## `/announcements` and `/announcements/[id]` deliberately have **no** `ROUTE_PERMISSIONS` row

**What:** `announcements:view` is held by all three presets — Owner by wildcard, Manager by
`ALL_PERMISSIONS`, Seller explicitly at `lib/permissions.ts:133` (contract §5). So there is no member
who can be signed in and fail this page.

**So what:** both pages still `await requirePageAccess()` and render `<ForbiddenScreen />` when not
permitted, which is what the repo-wide test in `lib/auth/require-page-access.test.ts` enforces and
what proves there is a session at all before anything renders. With no row in the map, no permission
is resolved and `permitted` is true for any signed-in member. The detail route inherits the parent's
absence by longest-prefix match. Adding a row would gate a page nobody can fail and would only be one
more place to be wrong.

`config/routes.ts` gained exactly one line: `announcement: (id) => \`/announcements/${id}\``, with a
comment saying why it has no permission row. This was the only shared file touched.

---

## Things I decided rather than looked up

Two, both stated here because neither is in the contract or the artboard.

1. **A detail route exists at all.** Artboard `2m` draws the feed and the reading layout as two
   panels side by side, which could equally have been an expanding card. I built a route, because
   `GET /announcements/:id` exists, because a notice is the sort of thing people send each other
   links to, and because the pin/edit/delete controls the artboard draws on the reading view need
   somewhere to live that is not a card in a feed. The cost if this is wrong is one route and one
   page file.
2. **Creating navigates to the new notice.** The form sheet's `onSaved` pushes to the detail route.
   The artboard does not say what happens after Post. Landing on the thing you just wrote, seen the
   way everyone else will see it, seemed the better answer than a feed that scrolled somewhere. The
   edit flow deliberately does *not* navigate — it is already there.

## One thing I could not verify

`DELETE` returning **204 with an empty body** is taken from the contract (§0,
`responses.ts:50`) and from `announcements.test.ts:166-182`, which proves the row is gone but
asserts the status, not the body's absence. The service is typed `Promise<void>` and the
adapter-level test asserts the call resolves to `undefined` against a 204 — so this side is correct
whatever the server sends, but a server that started returning `{ success: true }` on this route
would not fail any test in either repo.
