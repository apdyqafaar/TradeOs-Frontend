# Team (members & roles) — API contract

Extracted read-only from `Backend` (no edits made there). Every claim below is
`file:line` against that repo as of this read. Chains traced:

```
src/routes/v1/member.route.ts -> src/controller/member.controller.ts
  -> src/services/member.service.ts -> src/db/actions/member.actions.ts
  -> src/db/models/member.model.ts        (+ src/validators/member.validation.ts)

src/routes/v1/role.route.ts   -> src/controller/role.controller.ts
  -> src/services/role.service.ts   -> src/db/actions/role.actions.ts
  -> src/db/models/role.model.ts          (+ src/validators/role.validation.ts)
```

plus `src/lib/permissions.ts`, `src/middleware/auth.middleware.ts`,
`src/middleware/validate.middleware.ts`, `src/middleware/rate-limit.middleware.ts`,
`src/middleware/error.middleware.ts`, `src/util/errors.ts`, `src/util/responses.ts`,
`src/db/seed.ts`.

Tests read: `tests/integration/members/manage.test.ts`, `invite.test.ts`,
`invite-guards.test.ts`, `pagination.test.ts`, `tests/integration/roles.test.ts`,
and (for cross-checks) `tenant-isolation.test.ts`,
`email-verification-enforcement.test.ts`, `permissions-middleware.test.ts`,
`actions/member.actions.test.ts`, `actions/role.actions.test.ts`.

Everything asserted about zod below was **run**, not read — `bun` against the
real validator modules. The transcripts are quoted inline where they matter.

Base path is `/api/v1` (`Backend/src/app.ts:54`); `memberRouter` mounts at
`/members` and `roleRouter` at `/roles` (`src/routes/v1/index.ts:25-26`).

---

## 0. The middleware chain, and the two traps in it

Every one of the nine routes declares its **own** full chain — there is no
`router.use(...)` in either file, deliberately and at length
(`member.route.ts:28-47`, `role.route.ts:15-24`).

```
validate({ params?, query?, body }) -> requireAuth -> [requireVerifiedEmail] -> requireMember -> [inviteLimiter] -> requirePermission -> handler
```

**Trap 0a — validation runs before authentication.** `validate` is the first
link on all nine routes, so a malformed body/params/query on an anonymous
request is **422, not 401**. Proven three separate ways, each with no session
at all: `pagination.test.ts:271-280` (`?limit=101` -> 422),
`manage.test.ts:237-254` (a GET carrying a body -> 422 before any cookie
exists), `roles.test.ts:105-114` (`GET /roles` with a body -> 422, the test
comment noting it "doesn't depend on being signed in").

**Trap 0b — the two invite routes are rate-limited on the ORGANIZATION, not
the caller.** `inviteLimiter` = 50 requests / 60 minutes, `keyBy:
"organization"`, bucket name `member-invite`, **shared between
`POST /members/invite` and `POST /members/:id/resend-invite`**
(`member.route.ts:74-79`, wired at `:118` and `:129`). Three sends by two
different members across both endpoints land in one bucket
(`invite-guards.test.ts:259-295` asserts the key is literally
`member-invite:org:<organizationId>`). A business that has spent its hour on
fresh invitations cannot then spend it on resends. On exhaustion: **429
`TOO_MANY_REQUESTS`**, message `Too many attempts. Try again in N seconds.`,
plus a `Retry-After` header in seconds (`rate-limit.middleware.ts:161-167`).

Position is load-bearing and documented as such: the limiter sits **after**
`requireVerifiedEmail` and **before** `requirePermission`
(`member.route.ts:102-119`). So an unverified caller is refused *without*
spending allowance, while a caller who merely lacks `members:invite` *does*
spend it.

---

## 1. `GET /members` (`members:view`)

Route: `member.route.ts:81-88`.
`validate({ query: listMembersQuerySchema, body: noBodySchema })`.

```ts
// member.validation.ts:46-56
z.object({
  page:  z.coerce.number().int("Page must be a whole number").min(1, "Page starts at 1").default(1),
  limit: z.coerce.number().int("Limit must be a whole number").min(1, "Limit must be at least 1")
           .max(100, "Limit cannot be more than 100").default(20),
}).strict()
```

| param | type | required | default | source |
|---|---|---|---|---|
| `page` | coerced int, ≥1 | no | **`1`** | `member.validation.ts:48` |
| `limit` | coerced int, 1..100 | no | **`20`** | `member.validation.ts:49-54`, ceiling `:23`, default `:25` |

Body: `noBodySchema` = `z.object({}).strict().optional()`
(`common.validation.ts:21`) — a GET carrying **any** payload is 422.

Verified by running the real schema:

```
{}                     -> OK {"page":1,"limit":20}
{page:'3',limit:'10'}  -> OK {"page":3,"limit":10}
{limit:'101'}          -> FAIL [["limit","Limit cannot be more than 100"]]
{limit:''}             -> FAIL [["limit","Limit must be at least 1"]]
{pge:'3'}              -> FAIL [["","Unrecognized key: \"pge\""]]
```

`.strict()` means `?pge=3` is a **422, not a silent page 1**
(`pagination.test.ts:258-269`). `?page=0`, `?limit=0`, `?page=-1`,
`?limit=-5`, `?page=1.5`, `?page=abc`, `?limit=` are all 422 —
never a substituted default (`pagination.test.ts:225-240`). The 422's
`errors` map is keyed by the offending field name (`errors.limit`,
`pagination.test.ts:242-256`).

**Filter** (`member.actions.ts:21-24`, shared by the page read and the count
so the two can never disagree):

```js
{ organizationId, status: { $ne: "removed" } }
```

There is **no** `status`, `search` or `roleId` query param. The listing is
active + invited, always, and removed rows are excluded from both the page
and `meta.total` (`pagination.test.ts:176-198`).

**Sort**: `{ createdAt: 1, _id: 1 }` (`member.actions.ts:53`) — **oldest
first**, so the owner is normally row 1. This is the opposite of
`GET /sales`, which is newest-first. The `_id` tiebreak is load-bearing:
rows created in the same millisecond have no order under `createdAt` alone,
and `pagination.test.ts:103-137` asserts 25 ids across three pages are 25
*distinct* ids.

**Populates** (`member.actions.ts:51-52`):

```js
.populate("userId", "name email image status")
.populate("roleId", "name permissions isCustom")
```

Both are real documents by the time the controller sees them
(`actions/member.actions.test.ts:163-176` asserts `userId` and `roleId` are
no longer `ObjectId` instances and reads `.name`/`.email`/`.permissions` off
them). `invitedBy` is **not** populated — see §6.

### Response

`paginatedResponse(res, "Members fetched", rows.map(listedMember), { page, limit, total })`
(`member.controller.ts:104-108`; envelope `responses.ts:52-61`).

```json
{
  "success": true,
  "message": "Members fetched",
  "data": [ /* listedMember, see §6 */ ],
  "meta": { "page": 1, "limit": 20, "total": 4, "totalPages": 1 }
}
```

`data` is a **bare array**, never wrapped (`member.controller.ts:101-103`
says so explicitly; `pagination.test.ts:96` asserts `Array.isArray`).
`totalPages = Math.ceil(total / limit)`, computed server-side
(`responses.ts:60`). A page past the end is `data: []` with **200**, and
`meta` still reports the real total (`pagination.test.ts:139-153`).
`meta.total` is tenant-scoped — 3, not 12, when a neighbour has 9 members
(`pagination.test.ts:155-174`).

---

## 2. `POST /members/invite` (`members:invite` **+ verified email**)

Route: `member.route.ts:112-121`. Chain:
`validate -> requireAuth -> requireVerifiedEmail -> requireMember -> inviteLimiter -> requirePermission -> inviteMember`.

```ts
// member.validation.ts:4-7
z.object({
  email:  z.email("Enter a valid email address").toLowerCase(),
  roleId: objectIdSchema,   // /^[0-9a-fA-F]{24}$/  (common.validation.ts:5-7)
})
```

Both fields **required**. **No `.default()` anywhere.** **Not `.strict()`** —
unknown keys are silently **stripped**, not rejected. Verified:

```
{email:"A.B@Example.COM", roleId:"…", status:"active", organizationId:"…"}
  -> OK {"email":"a.b@example.com","roleId":"…"}
{}  -> FAIL [["email","Enter a valid email address"],
             ["roleId","Invalid input: expected string, received undefined"]]
```

The email is lowercased by the schema. `invite.test.ts:98-122` sends
`"New.Cashier@Example.com"` and asserts the response carries
`"new.cashier@example.com"`.

The stripping is deliberate and tested: `invite.test.ts:246-281` sends
`organizationId` and `status: "active"` in the body, gets **201**, and
asserts the member landed in the caller's own tenant as `invited` — the test
comment records that the BRD originally claimed 422 here and **was wrong**.

### Server logic (`member.service.ts:100-188`), in order

1. **Self-invite** — `input.email.toLowerCase() === inviter.email.toLowerCase()`
   -> **409** `"You are already a member of this business"` (`:122-124`).
   Refused *before* any DB write and before any mail: no member row, no
   verification token (`invite-guards.test.ts:134-152`). Case-insensitive
   (`invite-guards.test.ts:154-168`). Applies to any member, not just the
   owner (`invite-guards.test.ts:170-188`).
2. **Resolve the role** — `resolveAssignableRole` (`:30-48`):
   - unknown id -> **404** `"Role not found"` (`:35`);
   - a custom role belonging to another tenant -> **404**, never 403
     (`:37-39`; `invite.test.ts:159-179`);
   - the **Owner preset** -> **403** `"The Owner role cannot be assigned"`
     (`:43-45`; `invite.test.ts:143-157`). Presets other than Owner are
     assignable by anyone.
3. **Global one-org rule** — if a `User` exists for that email and holds an
   active membership *anywhere*, -> **409**
   `"That person already belongs to a business on TradeOs"` (`:128-134`;
   `invite.test.ts:223-244`, which also asserts no row was created in the
   inviting tenant).
4. **Any prior row in this org, regardless of status**
   (`findAnyMemberInOrganization`, `member.actions.ts:103-119`):
   - `invited` -> **409** `"That email already has a pending invitation"`
     (`:151-152`; `invite.test.ts:181-198`);
   - `removed` -> **reactivate that same row** via `reinviteRemovedMember`
     (`:153-159`, action `member.actions.ts:155-169`) — see §7;
   - `active` -> **409** `"That person already belongs to this business"`
     (`:160-165`, documented as a defensive backstop).
5. Otherwise `createMember({ organizationId, roleId, status: "invited",
   invitedEmail, invitedBy })` (`:167-173`).
6. **Issue the token** (`:176`, `issueInviteToken` `:50-66`): sweeps only the
   verifications for *this member* (`{ memberId }` metadata), then stores a
   hash of a fresh token with **`expiresAt` = now + 7 days**
   (`INVITE_TTL_MS`, `member.service.ts:23`).
7. **Send the mail** (`:180-185`, `deliverInvite` `:69-83`) — wrapped in
   try/catch. **A send failure is logged and swallowed; the endpoint still
   returns 201.** The invite row and token survive so it can be resent.

### Response — **201**

`createdResponse(res, "Invitation sent", { ...publicMember(member), role: { id, name } })`
(`member.controller.ts:45-48`).

```json
{ "success": true, "message": "Invitation sent",
  "data": { "id":"…", "status":"invited", "invitedEmail":"new.cashier@example.com",
            "roleId":"…", "createdAt":"…", "role": { "id":"…", "name":"Seller" } } }
```

Note the shape carries **both** `roleId` (a string) **and** `role`
(`{id,name}`) — and **no `user` key at all**. It is not the `GET /members`
row shape. See §6.

The raw invite token is **never** in the response
(`invite.test.ts:124-141` asserts the serialized 201 body contains no
substring `"token"`). The only way a client learns it is the email.

---

## 3. `POST /members/:id/resend-invite` (`members:invite` **+ verified email**)

Route: `member.route.ts:123-132`.
`validate({ params: memberIdParamSchema, body: noBodySchema })`.

- `params`: `{ id: /^[0-9a-fA-F]{24}$/ }` (`member.validation.ts:20` ->
  `common.validation.ts:10`). Malformed id -> **422**
  (`invite.test.ts:912-922`).
- `body`: **strict empty**. Any payload -> **422**, explicitly *unlike*
  `/members/invite` (`invite.test.ts:894-910`, whose comment spells out the
  contrast). You cannot change the address by resending.

Logic (`member.service.ts:193-216`):

1. Scoped lookup `findMemberInOrganization` — missing **or cross-tenant** ->
   **404** `"Member not found"` (`:199`). Cross-tenant is 404 and never 409:
   `tenant-isolation.test.ts:119-130` asserts the message does not match
   `/accepted/i`, and `invite.test.ts:825-845` asserts the victim's token was
   not rotated.
2. `member.status !== "invited" || !member.invitedEmail` -> **409**
   `"That member has already accepted their invitation"` (`:200-202`;
   `invite.test.ts:878-892`). So resending to an **active** member is 409,
   and resending to a **removed** member is also 409 (same branch).
3. Reissues the token, **invalidating the previous one** — one outstanding
   invitation per member, and the old link is genuinely dead, not merely
   rotated (`invite.test.ts:791-823` replays the stale token and gets 400).
4. Mails again, with the same swallow-on-failure behaviour.

### Response — **200**

`successResponse(res, "Invitation resent", 200, publicMember(member))`
(`member.controller.ts:60`).

**There is no `role` key on this response** — unlike invite and update. It is
bare `publicMember`, so the caller gets `roleId` as a string and nothing else
about the role.

---

## 4. `PATCH /members/:id` (`members:update`)

Route: `member.route.ts:134-141`.

```ts
// member.validation.ts:11-13
z.object({ roleId: objectIdSchema })
```

**One field, REQUIRED.** Not `.strict()` (extras stripped), and — this is the
question §0 of the brief asks — **no `.partial()`, and no `.default()`**.
Verified:

```
updateMemberSchema.safeParse({})
  -> FAIL [["roleId","Invalid input: expected string, received undefined"]]
updateMemberSchema.safeParse({roleId:"…", status:"active"})
  -> OK {"roleId":"…"}          // `status` stripped
```

`{}` is a **422**, not a no-op (`manage.test.ts:383`). This endpoint changes
**only the role** — there is no way to edit a member's name, email or status
through it.

Logic (`member.service.ts:261-285`), and the ordering is deliberate:

1. Scoped lookup -> **404** if missing or cross-tenant (`:266-267`).
2. `status === "removed"` -> **409** `"That member has been removed"` (`:274`).
3. Target is the organization's owner (matched on `Organization.ownerId`,
   **not** on a role name — `isOrganizationOwner`, `:246-253`) -> **403**
   `"The owner's role cannot be changed"` (`:276-278`).
4. `resolveAssignableRole` — so promoting anyone to **Owner** is **403**
   (`manage.test.ts:282-299` asserts the member keeps their old role), and a
   foreign/unknown role is 404.
5. Scoped update.

**No session revocation**, on purpose: `requireMember` re-reads the member row
and its role on every request and rebuilds `req.permissions` from what it just
read, so a demotion binds on the target's very next call
(`member.service.ts:255-260`; proven by
`permissions-middleware.test.ts:122-133` — role changed in the DB, no
re-login, next request 403).

An `invited` (not yet accepted) member **can** be re-roled, and stays
`invited` (`manage.test.ts:396-427`).

### Response — **200**

`successResponse(res, "Member updated", 200, { ...publicMember(member), role: { id, name } })`
(`member.controller.ts:128-131`) — the same shape as the invite 201.

---

## 5. `DELETE /members/:id` (`members:remove`)

Route: `member.route.ts:143-150`. `params` id-schema, `body` strict-empty
(a payload -> 422, `manage.test.ts:579-582`).

### It DEACTIVATES. It does not delete.

`updateMemberInOrganization(organizationId, memberId, { status: "removed" })`
(`member.service.ts:308`). The document stays, **keeps its `userId`**, and its
history stays attributable (`member.model.ts:21-22`;
`manage.test.ts:475-479` asserts the row is not null, is `"removed"`, and
still carries the user id).

Logic (`member.service.ts:287-326`), in order:

1. Scoped lookup -> **404** if missing or cross-tenant (`:292-293`).
2. Already `removed` -> **409** `"That member has already been removed"` (`:298`).
3. Target is `Organization.ownerId` -> **403**
   `"The owner cannot be removed from their own business"` (`:300-302`).
4. Target is the caller -> **403** `"You cannot remove yourself"` (`:304-306`).
   Matched on `member.userId === actorUserId`, so it cannot fire for an
   invited row (which has no `userId`).
5. Flip to `removed`.
6. **Revoke every session that user holds** (`:323`,
   `revokeAllSessions(member.userId)`). Sessions are user-scoped and a user is
   an active member of at most one organization, so this is not a cross-tenant
   side effect. `manage.test.ts:459-491` replays the removed member's cookie
   by hand and gets **401**. An invited member has no `userId` and the revoke
   is skipped entirely (`manage.test.ts:591-629`).

**Cancelling a pending invitation is this same endpoint** — the invited row
flips to `removed` and 200 comes back (`manage.test.ts:591-629`). There is no
separate cancel-invite route.

Guard order 3-before-4 matters: a **Manager** removing the owner gets the
owner-protection 403, not the self 403 (`manage.test.ts:493-508` acts it out
as a manager precisely so the owner guard is what fires).

### Response — **200**

`successResponse(res, "Member removed", 200, publicMember(member))`
(`member.controller.ts:142`) — bare `publicMember`, `status: "removed"`, no
`role`, no `user`. **Not 204.**

---

## 6. Response shapes — and the em-dash question

There are **two** member shapes on the wire, and they are not the same object.

### 6a. `listedMember` — `GET /members` only

`member.controller.ts:72-88`:

```ts
{
  id: string,                 // member.id  — the Mongoose `id` virtual (:80)
  status: "active" | "invited",   // never "removed" on this route (:81)
  invitedEmail?: string,      // present ONLY while invited (:82)
  joinedAt?: string,          // ISO; absent for an invited row (:83)
  createdAt: string,          // ISO (:84)
  user: { id: string, name: string, email: string, image?: string } | null,   // (:85)
  role: { id: string, name: string } | null,                                   // (:86)
}
```

### 6b. `publicMember` — invite (201), resend (200), update (200), remove (200)

`member.controller.ts:14-21`:

```ts
{
  id: string,            // member.id (:15)
  status: "active" | "invited" | "removed",   // (:16)
  invitedEmail?: string, // (:17)
  roleId?: string,       // member.roleId?.toString() — a BARE ID STRING (:18)
  joinedAt?: string,     // (:19)
  createdAt: string,     // (:20)
}
```

…to which **invite** and **update** (and *not* resend or remove) append
`role: { id, name }` (`:47`, `:130`).

**Ids on the wire are `id`.** Never `_id`, on any of the nine endpoints —
every one goes through a `public*`/`listed*` mapper that reads the Mongoose
`id` virtual. No `__v`, no `organizationId`, no `updatedAt` on a member.

`undefined` fields are **omitted keys**, not `null` — `JSON.stringify` drops
them. So an active member's row has **no `invitedEmail` key at all**, and an
invited member's row has **no `joinedAt` key**. Only `user` and `role` on the
listing are explicit `null`s.

### Does a member row carry the person's name? **Yes — on `GET /members` only.**

`user` is a **populated object**: `{ id, name, email, image? }`, drawn from
`.populate("userId", "name email image status")` (`member.actions.ts:51`) and
mapped at `member.controller.ts:85`. `manage.test.ts:121-139` asserts
`ownerRow.user.email` equals the owner's real address, with the comment "a
listing that cannot show who someone is does not answer 'who is on my team'".

`role` is likewise a populated `{ id, name }` (`:86`) — the role's
**`permissions` are populated into the document** (`member.actions.ts:52`)
but **the mapper does not emit them**. A members list will not tell you what a
member can do; you need `GET /roles` for that.

`user` is `null` in exactly two situations:

1. **An invited member has no `User` document yet.** `invitedEmail` carries
   the identity instead (`member.controller.ts:69-70`;
   `manage.test.ts:157-191` asserts `user === null` and
   `invitedEmail === "pending@example.com"`).
2. A dangling `userId` whose `User` no longer exists (defensive; the mapper
   guards on `user?.id`).

`role` is `null` only if the referenced role no longer exists — which the API
makes unreachable, since a role held by a non-removed member cannot be deleted
(§8). Treat it as defensive, but render for it.

### `invitedBy` — **not on the wire. Anywhere.**

`invitedBy` is stored (`member.model.ts:10,30`) and written on every invite
path (`member.service.ts:157,172`; `invite.test.ts:115` asserts it in the
database). But:

- it is **not** in `publicMember` (`member.controller.ts:14-21`),
- it is **not** in `listedMember` (`:72-88`),
- it is **not** populated by `findMembersByOrganization` (`member.actions.ts:51-52`).

Grepped the whole of `src` — the only references are the model, the two db
actions, and the two service writes. **"Invited by whom" cannot be rendered
from this API.** Do not design a column for it.

### The em-dash problem: fixable, with two named limits

`MemberRef` (`Frontend/features/sales/components/sale-table.tsx:235-263`)
renders a literal `—` because `soldBy` / `voidedBy` are bare **Member** id
strings (`Backend/src/controller/sale.controller.ts:44,42`), as are
`StockMovement.createdBy`
(`Frontend/features/products/components/stock-movements-table.tsx:74-75`) and
the import job's `createdBy`
(`Frontend/features/product-import/hooks/use-import-jobs.ts:34`).

`GET /members` is the missing lookup table, and **the join key lines up
exactly**: rows are keyed by `member.id` (`member.controller.ts:80`), and
`sale.soldBy` is a `ref: "Member"` id (`Backend/src/db/models/sale.model.ts:106`).
So `memberId -> row.user.name` resolves every one of those columns.

Two limits that will bite, both from source:

- **Removed members are not in the listing** (`member.actions.ts:21-24`;
  `pagination.test.ts:176-198`). A sale recorded by someone who has since been
  removed has **no** row to join against, and the em dash must survive for
  that case. There is no `?status=all` and no `GET /members/:id`.
- **Invited members have `user: null`** — but they also cannot have recorded a
  sale, so they will not appear as a `soldBy`. For a members *table* they still
  need `invitedEmail` as the fallback identity.

Also note: `GET /members` is gated on `members:view`, which **the Seller preset
holds** (`permissions.ts:126`). So every preset role can build the map. A
custom role without `members:view` gets 403 and must fall back to the dash.

`GET /auth/me` does **not** return the caller's own member id — it returns
`user`, `organization`, `role`, `permissions`, `twoFactorEnabled` only
(`auth.controller.ts:94-107`). To mark "this row is me" in the members table,
compare `me.user.id` against `row.user.id`; there is no member-id route to it.

---

## 7. The member / invite lifecycle

### The status enum

`member.model.ts:8`, `:23-28` — `["active", "invited", "removed"]`,
**required**, model default `"invited"`.

| status | means | has `userId`? | has `invitedEmail`? | has `joinedAt`? | in `GET /members`? | can sign in to this org? |
|---|---|---|---|---|---|---|
| `invited` | Invitation sent, not accepted | no (unless a re-invited removed member — see below) | **yes** | no | **yes** | no — `requireMember` requires `status: "active"` (`member.actions.ts:16`); `permissions-middleware.test.ts:147-153` |
| `active` | Accepted, on the team | yes | **no** (`$unset` on accept) | yes | **yes** | yes |
| `removed` | Access revoked, record retained | **yes, retained** | possibly | possibly | **no** | no — 403 `"You do not belong to a business yet"` |

The owner's own row is created `active` with `joinedAt` at organization
creation (`organization.service.ts:140-149`).

### What an invitation looks like before acceptance

A `Member` document with `status: "invited"`, `roleId`, `invitedEmail` (lower-
cased, trimmed — `member.model.ts:29`), `invitedBy`, **no `userId`**, **no
`joinedAt`** (`invite.test.ts:113-115`). Alongside it, one `Verification`
document of `type: "invite"`, `identifier` = the email, `metadata.memberId` =
this member, holding a **hash** of the token, expiring in **7 days**
(`member.service.ts:23,56-64`; `invite.test.ts:117-119`).

The token is scoped to the member, not to the address: two businesses can hold
outstanding invitations to the same person simultaneously and neither sweeps
the other's (`member.service.ts:51-56`; `invite.test.ts:597-657` asserts both
tokens work).

Two unique partial indexes constrain this (`member.model.ts:46-59`):
`(organizationId, userId)` unique where `userId` exists — **covering removed
rows**; `(organizationId, invitedEmail)` unique where `status: "invited"`;
and `(userId)` unique where `status: "active"` — the database-level
"one active organization per user" rule.

### Acceptance (context — `POST /auth/accept-invite`, outside this slice)

`auth.service.ts:310-449`. Consumes the token, creates the `User` with
**`emailVerified: true`** ("the invite proves control of the address",
`:409-413`), then `activateInvitedMember` sets
`{ userId, status: "active", joinedAt: new Date(), $unset: { invitedEmail } }`
(`member.actions.ts:127-136`). The token is deleted on use, not left to a TTL
sweep, so it cannot be replayed (`invite.test.ts:697-741`). An unknown or
expired token is **400**, not 404 (`invite.test.ts:743-780`).

### Re-inviting someone who was removed

This is the one thing the service comments call out as "the one thing this
task must not get wrong" (`member.service.ts:136-144`). A removed row **keeps
its `userId`**, so inserting a second document would collide with the unique
`(organizationId, userId)` index at acceptance time and lock that person out
permanently. Instead `reinviteRemovedMember` (`member.actions.ts:155-169`)
updates the **existing** row in place — `status: "invited"`, new `roleId`, new
`invitedEmail`, new `invitedBy` — and deliberately does **not** touch
`userId`. Filtered on `status: "removed"` as a backstop.

Consequence for the UI: **a re-invited former member is an `invited` row that
still has a `userId`.** `listedMember` will therefore show a populated `user`
object **and** an `invitedEmail`, with `status: "invited"`. Do not assume
`status === "invited"` implies `user === null` — it usually does, but not
here. (`invite.test.ts:311-368` asserts exactly one row, same `_id`, status
`invited`, `userId` retained.)

Accepting as a returning member also applies the submitted password and name,
and revokes their pre-existing sessions before issuing the new one
(`auth.service.ts:374-397,442`; `invite.test.ts:397-429`, `:431-479`).

### Resending

Covered in §3. Summary: same member id, same address (you cannot change it),
old token dies, new 7-day token issued, 200 with bare `publicMember`.

---

## 8. Roles

### 8a. The model

`role.model.ts:3-27`:

```ts
{
  organizationId: ObjectId | null,   // null == a GLOBAL PRESET (:5, :16-20, default null)
  name: string,                      // required, trimmed, maxlength 60 (:21)
  description?: string,              // trimmed, maxlength 200 (:22)
  permissions: string[],             // required, default [] (:23)
  isCustom: boolean,                 // required, default true (:24)
}
```

Unique index on `(organizationId, name)` (`:31`) — and because null
organizationIds collide with each other, that is also what keeps **preset
names globally unique**.

**Permissions are a flat array of `"resource:action"` strings.** Not a bitmask,
not nested, not a `{ resource: [actions] }` object. The Owner preset's array is
the single element `["*"]`.

### 8b. Are Owner / Manager / Seller real Role documents? **Yes.**

They are real documents in the `roles` collection with `organizationId: null`
and `isCustom: false`, re-asserted from code at **every server boot**
(`db/seed.ts:17-25` -> `role.actions.ts:35-63`). They are shared by every
organization — one document each, platform-wide, not per-tenant copies. The
seed intentionally overwrites manual DB edits and is how a later backend phase
hands a new permission to every existing business without a migration
(`seed.ts:5-16`).

Their contents (`permissions.ts:107-137`), counted by running the module:

| preset | permissions | note |
|---|---|---|
| **Owner** | **`["*"]`** — 1 entry, the wildcard | `hasPermission` short-circuits on `"*"` (`permissions.ts:98-99`), so Owner automatically gains permissions added by future phases (`permissions-middleware.test.ts:174-178`) |
| **Manager** | **42** — every catalog permission **except `organization:delete`** (`permissions.ts:116`) | enumerated, no wildcard, so a Manager is **refused** a permission outside today's catalog (`permissions-middleware.test.ts:179-184`) |
| **Seller** | **13** — `organization:view`, `members:view`, `products:view`, `categories:view`, `customers:view`, `customers:create`, `customers:update`, `sales:view`, `sales:create`, `debts:view`, `payments:create`, `announcements:view`, `projects:view` (`permissions.ts:121-135`) | holds `members:view` — see §11 |

Note that **`organization:delete` is granted to nobody but Owner (via the
wildcard) and is currently used by no route** — `organizationRouter` mounts
only `POST /`, `GET /current`, `PATCH /current` and the two currency routes
(`organization.route.ts:50-103`). So Manager and Owner are indistinguishable
at the permission gate today; what actually separates them is the two
`Organization.ownerId` guards in §4 and §5.

### 8c. `GET /roles` (`roles:view`)

Route: `role.route.ts:25-32`. `validate({ body: noBodySchema })` — **no query
params at all**. A GET with a body -> 422 (`roles.test.ts:105-114`).

Query: `Role.find({ $or: [{ organizationId: null }, { organizationId }] }).sort({ isCustom: 1, name: 1 })`
(`role.actions.ts:7-8`) — **the three global presets plus this organization's
own custom roles**, and never another tenant's (`roles.test.ts:86-103`,
`tenant-isolation.test.ts:132-146`).

Sort: `isCustom` ascending first (`false` < `true`), so **presets come first**
(alphabetically Manager, Owner, Seller), then custom roles alphabetically.

Response: `successResponse(res, "Roles fetched", 200, roles.map(publicRole))`
(`role.controller.ts:21`).

> **This list is NOT paginated.** No `page`/`limit`, and **no `meta` key in
> the body at all** — `successResponse` omits `meta` when it is undefined
> (`responses.ts:42`). Do not reuse the `GET /members` list handler.

`publicRole` (`role.controller.ts:9-16`):

```ts
{
  id: string,              // role.id — not _id (:10)
  name: string,            // (:11)
  description?: string,    // omitted key when unset (:12)
  permissions: string[],   // the full array; ["*"] for Owner (:13)
  isCustom: boolean,       // false for the three presets (:14)
  isPreset: boolean,       // role.organizationId === null (:15)
}
```

`isCustom` and `isPreset` are two different fields that, for every role the
API can create, hold **opposite** values (`isPreset === !isCustom`). Both are
emitted; `organizationId` itself is not.

### 8d. `POST /roles` (`roles:create`)

Route: `role.route.ts:34-41`.

```ts
// role.validation.ts:25-29
z.object({
  name:        z.string().trim().min(1, "Role name is required").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: permissionList,       // REQUIRED — no .default([])
})

// permissionList, role.validation.ts:13-20
z.array(
  z.string()
   .refine(v => v !== "*", "The wildcard permission cannot be granted")
   .refine(v => isPermission(v), "Unknown permission — not in the catalog")
).max(43)                            // ALL_PERMISSIONS.length
```

**No `.default()` on any field.** Not `.strict()`. `permissions` is
**required** — omitting it is a 422, it does not default to `[]`
(the *model* defaults to `[]`, the *schema* does not). Verified:

```
{name:"X"}                          -> FAIL [["permissions","…expected array, received undefined"]]
{name:"  Padded  ", permissions:[]} -> OK {"name":"Padded","permissions":[]}   // an EMPTY array is legal
{name:"X", permissions:["*"]}       -> FAIL [["permissions.0","The wildcard permission cannot be granted"]]
{name:"X", permissions:["members:teleport"]}
                                    -> FAIL [["permissions.0","Unknown permission — not in the catalog"]]
{name:"   ", permissions:[]}        -> FAIL [["name","Role name is required"]]   // trim then min(1)
{name:"a"*61, permissions:[]}       -> FAIL [["name","Too big: expected string to have <=60 characters"]]
{permissions: <43 catalog entries>} -> ACCEPTED
{permissions: <44 entries>}         -> FAIL [["permissions","Too big: expected array to have <=43 items"]]
{permissions:["members:view","members:view","members:view"]} -> ACCEPTED, duplicates preserved
```

`name` and `description` are `.trim()`ed by the schema before storage.
The wildcard produces two issues on the same path; `zodToFieldErrors` keeps
the **first**, so the errors map reads
`{"permissions.0":"The wildcard permission cannot be granted"}`
(`error.middleware.ts:9-16`, run and confirmed).
**Duplicates are not de-duplicated** — send a clean set.

Service (`role.service.ts:17-30`): rejects the three reserved names
case-insensitively and after trimming (`isReservedRoleName`,
`role.validation.ts:23,48-49`; `isReservedRoleName("  oWNer ") === true`,
`"Ownerly" === false`) with **409** `"\"<name>\" is a built-in role name"`
(`roles.test.ts:163-175`). Then `createRole` forces
`isCustom: true` and the caller's `organizationId` (`role.actions.ts:13-16`) —
neither is client-supplied.

Response: **201**, `createdResponse(res, "Role created", publicRole(role))`
(`role.controller.ts:28`).

> **A duplicate custom-role name has no service check** — it relies on the
> `(organizationId, name)` unique index and surfaces through the generic
> duplicate-key branch (`error.middleware.ts:105-110`) as a **409 with a
> different body shape**: `{ success:false, message:"Resource already exists",
> errors:{ name:"That name is already taken" } }` — **no `code` key**. Every
> other role error carries `code`. Handle both.

### 8e. `PATCH /roles/:id` (`roles:update`)

Route: `role.route.ts:43-50`.

```ts
// role.validation.ts:31-39
z.object({
  name:        z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).optional(),
  permissions: permissionList.optional(),
}).refine(data => Object.keys(data).length > 0, { message: "Provide at least one field to update" })
```

**This is the schema the brief asks about. It does NOT use `.partial()`, and
it carries no `.default()` on any field.** The optionality is hand-written,
one `.optional()` per field. Verified by inspecting the compiled shape:

```
updateRoleSchema.name:        type=optional
updateRoleSchema.description: type=optional
updateRoleSchema.permissions: type=optional
```

— no `type=default` anywhere in either member or role validators, and the only
`.default()`s in this whole slice are `page`/`limit` on the **query** schema
(`listMembersQuerySchema.page: type=default`,
`listMembersQuerySchema.limit: type=default`), which is not an update schema
and cannot exhibit the defect.

**The defect is real in this zod version — it just is not present here.**
Proven directly against `Backend/node_modules/zod@4.4.3`:

```ts
const s = z.object({ status: z.string().default("draft"), name: z.string() });
s.parse({ name: "x" })            // {"status":"draft","name":"x"}
s.partial().parse({})             // {"status":"draft"}   <-- the default SURVIVES .partial()
```

So had anyone written `createRoleSchema.partial()` here, a PATCH omitting a
field would have written that field's default over the stored value. They did
not. Confirmed on the real schemas:

```
updateRoleSchema.parse({name:'X'})                    keys = [ "name" ]
createRoleSchema.parse({name:'X',permissions:[]})     keys = [ "name", "permissions" ]
```

Absent keys stay absent, so `updateCustomRole` receives only what the client
sent and Mongoose's `findOneAndUpdate` touches only those paths
(`role.actions.ts:19-27`). **A PATCH is a true partial update.**

Behaviour verified:

```
{}                    -> FAIL, errors map = {"_":"Provide at least one field to update"}
{name:"New"}          -> OK {"name":"New"}
{permissions:[]}      -> OK {"permissions":[]}      // stripping a role to zero permissions is legal
{description:""}      -> OK {"description":""}      // description has no min(1)
{nope:1}              -> FAIL {"_":"Provide at least one field to update"}   // unknown key stripped first, then the refine fires
{name:"New", nope:1}  -> OK {"name":"New"}
```

> The empty-body 422 lands under the field key **`_`**, not under a real field
> name (`error.middleware.ts:12` maps a zero-length issue path to `"_"`). A
> form that maps `errors` onto inputs will show nothing for this one.
>
> The refine counts **keys, not defined values** — `{name: undefined}` passes
> and parses to `{}`. Over HTTP this is unreachable, because `JSON.stringify`
> drops `undefined` keys and the wire value is `{}`, which 422s. Reachable
> only if something calls the schema in-process.

Service (`role.service.ts:54-67`), ordered:

1. `assertMutable` (`:37-52`): unknown id -> **404**; `!isCustom ||
   organizationId === null` -> **403** `"Built-in roles cannot be changed"`;
   another tenant's role -> **404**, never 403, "a 403 would confirm the id
   exists" (`:46-47`).
2. Reserved name -> **409**.
3. Scoped update (`isCustom: true` in the filter as well).

`roles.test.ts:213-224` proves editing a preset is 403.
`roles.test.ts:241-273` is the sharp one: a cross-tenant PATCH with
`{name:"Owner"}` must be **404**, and the same request from inside the tenant
is **409** — because a leaking read would reach the reserved-name check and
answer 409 *about another business's role*. The test comment records that it
was break-tested by deleting the tenant comparison.

Response: **200**, `successResponse(res, "Role updated", 200, publicRole(role))`
(`role.controller.ts:36`) — the full `publicRole`, so the client gets the
merged result back and does not need a refetch.

### 8f. `DELETE /roles/:id` (`roles:delete`)

Route: `role.route.ts:52-59`. `params` id-schema, `body` strict-empty.
Malformed id -> **422** from the params schema, not a 500 from a Mongoose
CastError (`roles.test.ts:401-411`).

Service (`role.service.ts:69-90`):

1. `assertMutable` — same 404 / 403 / 404 ladder. **Presets can never be
   deleted.**
2. **In-use check** — `countActiveMembersUsingRole(organizationId, roleId)`,
   which counts members with `status: { $ne: "removed" }`
   (`member.actions.ts:84-87`). If `> 0` -> **409** with a message built from
   the count:
   `"This role cannot be deleted: 1 member still has it. Move them to another role first."`
   (singular/plural handled at `role.service.ts:80-85`;
   `roles.test.ts:379-399` asserts `/1 member/i`).
3. Scoped hard delete (`role.actions.ts:29-32`) — the Role document is
   **actually removed** from the collection (`roles.test.ts:362-377` asserts
   `findById` returns null).

### What happens to members holding a deleted role? **Nothing — the delete is refused first.**

That is the whole point of step 2 (`role.service.ts:75-77`: deleting a role in
use "would orphan those members' access silently — requireMember resolves
roleId on every request and would start failing for them the moment it no
longer exists"). There is no cascade, no reassignment, no "move to default".
**The UI must move members off a role before it can delete it**, and the 409
message is written for a human to read verbatim.

The one gap: the count excludes `removed` members, so a role held **only** by
removed members *can* be deleted. Those rows then reference a role that no
longer exists — which is why `listedMember` guards `role` with a null check
(`member.controller.ts:86`). It is invisible in `GET /members` (removed rows
are filtered out) but would matter if that member were ever re-invited —
except `reinviteRemovedMember` always writes a fresh `roleId` from the new
invite, so it self-heals. **Unverified by any test**; reasoned from
`member.actions.ts:87` + `:155-169`.

Response: **200**, `successResponse(res, "Role deleted")`
(`role.controller.ts:45`) — **no `data` key at all**, because
`successResponse` omits `data` when it is `undefined` (`responses.ts:41`).
Body is exactly `{ "success": true, "message": "Role deleted" }`. **Not 204.**

---

## 9. `requireVerifiedEmail` — confirmed, and what the caller gets

Confirmed on both invite routes and **only** those two, from source:
`member.route.ts:116` (`POST /members/invite`) and `:127`
(`POST /members/:id/resend-invite`). It is absent from `GET /members`,
`PATCH /members/:id`, `DELETE /members/:id` and from all four role routes —
the file states why at `:90-100`: these are "the two endpoints in the whole
API that send mail to a THIRD PARTY on the caller's say-so", while the other
routes "touch only data inside a business the caller already belongs to, and
reach nobody".

Implementation (`auth.middleware.ts:98-109`) — no DB read; `requireAuth`
already re-read the user, so `req.user.emailVerified` is as fresh as it gets:

```ts
if (!req.user) throw new UnauthorizedError();
if (!req.user.emailVerified) throw new EmailNotVerifiedError();
```

**An unverified caller gets, exactly:**

```
HTTP/1.1 403 Forbidden
{
  "success": false,
  "message": "Confirm your email address before doing this. Check your inbox for the link, or request a new one.",
  "code": "EMAIL_NOT_VERIFIED"
}
```

`EmailNotVerifiedError extends ForbiddenError` with an overridden code
(`util/errors.ts:69-75`), and the class comment states the reason plainly:
"a missing permission means 'ask an owner', while this means 'open your
inbox', and it is the only 403 in the system the caller can clear entirely on
their own. A frontend that had to tell the two apart by reading message text
would break the first time the wording changed."

**Branch on `code === "EMAIL_NOT_VERIFIED"`, never on the message.**

Proven end to end: `email-verification-enforcement.test.ts:155-179` asserts
403 + `code === "EMAIL_NOT_VERIFIED"` on invite, **and** that nothing was
staged — zero invite verifications, and the org still holds only its owner.
`:181-205` does the same for resend against an invitation that already exists,
so it is the gate and not a missing target that refuses.

Because the gate sits **before** `inviteLimiter` (`member.route.ts:116-118`),
an unverified caller's refusal costs their business no send allowance.

The escape hatch is intact: `/auth/verify-email` and
`/auth/resend-verification` are deliberately **not** gated
(`auth.middleware.ts:87-92`), so an unverified user is never trapped.

---

## 10. Error codes

Wire shape on failure (`responses.ts:63-79`, `error.middleware.ts:80-98`):

```json
{ "success": false, "message": "…", "code": "…", "errors": { … }, "details": { … } }
```

`errors` appears only on 422s, `code` only on `AppError`-derived failures,
`details` only when the raising error supplied it (no member/role error does).
**Branch on `code`; treat `message` as display text.**

| HTTP | `code` | Condition | Exact message string | Source |
|---|---|---|---|---|
| 401 | `UNAUTHORIZED` | No session cookie | `"Authentication required"` | `errors.ts:39`, `auth.middleware.ts:41` |
| 401 | `UNAUTHORIZED` | Unknown/expired session, or the user is gone | `"Your session has expired, please sign in again"` | `auth.middleware.ts:44,49` |
| 403 | `FORBIDDEN` | Caller's account is banned | `user.banReason ?? "This account has been banned"` | `auth.middleware.ts:52-54`; `manage.test.ts:193-213` asserts the ban reason comes back as the message |
| 403 | `FORBIDDEN` | Caller's account is suspended | `"This account is suspended"` | `auth.middleware.ts:55-57` |
| 403 | **`EMAIL_NOT_VERIFIED`** | Invite / resend by an unverified caller | `"Confirm your email address before doing this. Check your inbox for the link, or request a new one."` | `errors.ts:69-75`; `email-verification-enforcement.test.ts:170-171` |
| 403 | `FORBIDDEN` | Caller has no active membership (incl. a member who was just removed) | `"You do not belong to a business yet"` | `auth.middleware.ts:134`; `permissions-middleware.test.ts:135-140` |
| 403 | `FORBIDDEN` | The organization is not `active` | `"This business is suspended"` | `auth.middleware.ts:142` |
| 403 | `FORBIDDEN` | Caller's own role document is missing | `"Your role could not be found"` | `auth.middleware.ts:143` |
| 403 | `FORBIDDEN` | Role lacks the route's permission | `"You do not have permission to do that"` | `auth.middleware.ts:168`; Seller cases at `manage.test.ts:439-455`, `:639-651`, `invite.test.ts:283-296`, `roles.test.ts:177-187` |
| 403 | `FORBIDDEN` | **Assigning the Owner preset** (invite or PATCH) | `"The Owner role cannot be assigned"` | `member.service.ts:44`; `invite.test.ts:143-157`, `manage.test.ts:282-299` |
| 403 | `FORBIDDEN` | **Changing the owner's own role** | `"The owner's role cannot be changed"` | `member.service.ts:277`; `manage.test.ts:301-315` |
| 403 | `FORBIDDEN` | **Removing the owner** | `"The owner cannot be removed from their own business"` | `member.service.ts:301`; `manage.test.ts:493-508` |
| 403 | `FORBIDDEN` | **Removing yourself** | `"You cannot remove yourself"` | `member.service.ts:305`; `manage.test.ts:510-522` |
| 403 | `FORBIDDEN` | Editing or deleting a preset role | `"Built-in roles cannot be changed"` | `role.service.ts:44`; `roles.test.ts:213-224` |
| 404 | `NOT_FOUND` | Member id unknown **or in another tenant** | `"Member not found"` | `errors.ts:85-87`, `member.service.ts:199,267,283,293,309`; `manage.test.ts:317-333`, `tenant-isolation.test.ts:87-130` |
| 404 | `NOT_FOUND` | Role id unknown, in another tenant, or (on assign) a foreign custom role | `"Role not found"` | `member.service.ts:35,38`; `role.service.ts:42,49,65,88`; `roles.test.ts:278-316` |
| 409 | `CONFLICT` | Inviting **your own** address | `"You are already a member of this business"` | `member.service.ts:123`; `invite-guards.test.ts:115-132` asserts the message verbatim |
| 409 | `CONFLICT` | Invitee already actively belongs to **any** business | `"That person already belongs to a business on TradeOs"` | `member.service.ts:132`; `invite.test.ts:223-244` |
| 409 | `CONFLICT` | Invitee already has a pending invite **here** | `"That email already has a pending invitation"` | `member.service.ts:152`; `invite.test.ts:181-198` |
| 409 | `CONFLICT` | Invitee is already active **here** (backstop) | `"That person already belongs to this business"` | `member.service.ts:165` |
| 409 | `CONFLICT` | Resending to a member who is not `invited` | `"That member has already accepted their invitation"` | `member.service.ts:201`; `invite.test.ts:878-892` |
| 409 | `CONFLICT` | PATCH on a `removed` member | `"That member has been removed"` | `member.service.ts:274`; `manage.test.ts:343-368` |
| 409 | `CONFLICT` | DELETE on an already-`removed` member | `"That member has already been removed"` | `member.service.ts:298`; `manage.test.ts:550-570` |
| 409 | `CONFLICT` | Role name is `owner`/`manager`/`seller` (trimmed, case-insensitive) | `"\"<name>\" is a built-in role name"` | `role.service.ts:22,61`; `roles.test.ts:163-175` |
| 409 | `CONFLICT` | Deleting a role members still hold | `"This role cannot be deleted: N member(s) still has/have it. Move them to another role first."` | `role.service.ts:80-85`; `roles.test.ts:379-399` |
| 409 | *(none)* | **Duplicate custom-role name** — hits the unique index, not a service check | `"Resource already exists"`, with `errors: { name: "That name is already taken" }` and **no `code` key** | `error.middleware.ts:105-110`, `errors.ts:175-182`, index `role.model.ts:31` |
| 422 | `VALIDATION_ERROR` | Any zod failure — malformed `:id`, bad email, bad `roleId`, missing required field, out-of-range `page`/`limit`, unknown query param, unexpected body on a no-body route, unknown/wildcard permission, empty PATCH body | `"Validation failed"` + an `errors` map | `errors.ts:100-119`, `validate.middleware.ts:80` |
| 429 | `TOO_MANY_REQUESTS` | >50 invites+resends per hour **per organization** | `"Too many attempts. Try again in N seconds."` + `Retry-After` header | `rate-limit.middleware.ts:161-167`, `member.route.ts:74-79` |

### The self-targeting cases, stated plainly

- **Inviting yourself** — 409, refused before any write or mail
  (`member.service.ts:122-124`).
- **Removing yourself** — 403 `"You cannot remove yourself"`
  (`member.service.ts:304-306`). Matched on `member.userId === actorUserId`.
- **Changing your own role** — there is **no self-check** on PATCH. A Manager
  holding `members:update` **can** demote themselves (or promote another
  Manager). The only PATCH guards are "not the owner" and "not to Owner". No
  test covers self-demotion; this is read from `changeMemberRole`
  (`member.service.ts:261-285`), where no comparison against the acting user
  exists. Because permissions are re-read per request
  (`permissions-middleware.test.ts:122-133`), a self-demotion binds on the very
  next call and could lock the actor out of the members screen.
- **"The last owner"** — there is **no rule by that name**. The invariant is
  enforced structurally instead: the owner is whoever `Organization.ownerId`
  names (`member.service.ts:246-253`), that member cannot be removed (403) and
  cannot be re-roled (403), and the Owner preset cannot be assigned to anyone
  else (403). So an organization always has exactly one owner and can never
  reach zero through these endpoints. **There is no ownership-transfer
  endpoint anywhere in the API** — `ownerId` is written once, at organization
  creation (`organization.service.ts:126`), and grepping `src` finds no other
  writer. Do not build a "transfer ownership" UI against this backend.

---

## 11. The permission catalogue

Canonical list: **`Backend/src/lib/permissions.ts:8-71`**. Nothing outside that
file may invent a permission string (`:1-7`).

**43 permissions**, in 13 groups. Counted by running the module, not by eye:

| group | count | permissions |
|---|---|---|
| `organization` | 3 | `view`, `update`, `delete` |
| `members` | 4 | `view`, `invite`, `update`, `remove` |
| `roles` | 4 | `view`, `create`, `update`, `delete` |
| `customers` | 4 | `view`, `create`, `update`, `delete` |
| `products` | 5 | `view`, `create`, `update`, `delete`, `adjust_stock` |
| `categories` | 4 | `view`, `create`, `update`, `delete` |
| `sales` | 3 | `view`, `create`, `void` |
| `debts` | 3 | `view`, `create`, `write_off` |
| `payments` | 2 | `create`, `void` |
| `reports` | 1 | `view` |
| `announcements` | 4 | `view`, `create`, `update`, `delete` |
| `projects` | 5 | `view`, `create`, `update`, `delete`, `publish` |
| `uploads` | 1 | `create` |

Format is `resources:action` with a **plural** resource, and the one
multi-word action uses a **snake_case** verb: `products:adjust_stock`,
`debts:write_off`. There is no `uploads:view` and no `uploads:delete` —
`uploads:create` covers both listing and deletion (`permissions.ts:66-70`).

`WILDCARD = "*"` (`:78`) is **not grantable** to a custom role — the validator
refuses it (`role.validation.ts:17`) and `roles.test.ts:152-161` proves the
422. It belongs to the Owner preset alone.

### Drift against the frontend mirror: **none.**

`Frontend/lib/auth/permissions.ts:11-67` is a declared mirror
(`:1-10`). Diffed by importing both modules and comparing:

```
backend count: 43   frontend count: 43
in backend, missing from frontend: []
in frontend, missing from backend: []
key names differ: [] []
keys whose VALUE differs: []
key ORDER identical: true
Seller preset backend: 13   frontend PRESET_SELLER: 13
  same members: true
  same order: true
```

The mirror also carries `hasEveryPermission` / `hasSomePermission`, which the
backend does not have — an addition, not drift. The backend's `hasPermission`
types `required` as `string` (so the Owner wildcard can cover future
permissions); the frontend types it as `Permission` (so a typo at a call site
is a compile error). That divergence is deliberate and documented on both
sides (`permissions.ts:92-96`, `Frontend/lib/auth/permissions.ts:80-85`).

**No change is needed to the mirror for this slice.**

One standing warning, already recorded in the mirror
(`Frontend/lib/auth/permissions.ts:104-113`) and confirmed here at
`permissions.ts:126`: **a Seller holds `members:view`.** Gating a *management*
screen on `members:view` shows it to every Seller. Gate on an action
permission — `members:invite`, `members:update`, `members:remove`,
`roles:view` (which Sellers do **not** hold) — instead.

---

## 12. What the tests prove that the source does not make obvious

1. **The invite body is not strict, and that is intentional.** Sending
   `organizationId` and `status: "active"` returns **201** with the extras
   stripped, not 422 (`invite.test.ts:246-281`). The test comment records that
   the requirements document claimed 422 and was corrected.
   The **resend** route, by contrast, is strict and 422s on any body
   (`invite.test.ts:894-910`).
2. **404-vs-409 is how tenant scoping is proven, and it tells you the read is
   guarded.** A `removed` member is **409 inside** the tenant and **404
   across** it (`manage.test.ts:343-368`, `:550-570`); the same trick isolates
   the role read (`roles.test.ts:241-273` for PATCH, `:335-360` for DELETE —
   both explicitly break-tested). Practical consequence: **you can never
   distinguish "no such member/role" from "belongs to someone else" from the
   response.** Both are a bare 404.
3. **Removal is a status flip, not a delete, and it kills sessions
   synchronously.** The removed user's cookie replayed by hand returns 401
   immediately (`manage.test.ts:459-491`). A *failed* removal revokes nothing
   (`manage.test.ts:524-546`).
4. **Cancelling an invitation is `DELETE /members/:id`**, works on a row with
   no `userId`, and disturbs nobody else's sessions
   (`manage.test.ts:591-629`).
5. **A role change binds on the next request with no re-login**
   (`permissions-middleware.test.ts:122-133`) — do not force a sign-out after
   PATCHing someone's role, and do refetch `GET /auth/me` after changing your
   own.
6. **Both invite endpoints share one hourly bucket keyed on the
   organization**, asserted down to the literal key
   `member-invite:org:<id>` (`invite-guards.test.ts:259-295`). A 429 on
   "resend" can be caused by someone else's fresh invitations.
7. **Two businesses can hold outstanding invitations to the same address
   simultaneously**, and neither kills the other's token
   (`invite.test.ts:597-657`).
8. **A re-invited former member keeps their original member row and `_id`**
   (`invite.test.ts:311-368`) — so the id in your table does not change, and
   the row will carry both a populated `user` and an `invitedEmail`.
9. **Pages are disjoint and complete even when every row shares a
   `createdAt`** (`pagination.test.ts:103-137`) — safe to page a bulk-imported
   team.
10. **Every preset except a permission-less custom role holds
    `members:view`** — the permission gate on `GET /members` could only be
    exercised at all by minting an empty custom role
    (`manage.test.ts:215-235`).
11. **A malformed id is 422 from the params schema, never a 500 from a
    Mongoose CastError** (`roles.test.ts:401-411`).

---

## 13. Traps

Ordered by how likely a frontend developer is to guess wrong.

**T1 — There are two different member shapes, and only one carries the
person.** `GET /members` rows have `user: {id,name,email,image}` and
`role: {id,name}`, and **no `roleId`**. The four mutating endpoints return
`publicMember`, which has **`roleId` as a bare string**, **no `user` at all**,
and `role: {id,name}` on only *two* of the four (invite and update — **not**
resend, **not** remove). A UI that optimistically splices a PATCH response
into its list row will blank the person's name and lose the role on a resend
or a remove. **Refetch the list after any mutation**, or merge field-by-field.
(`member.controller.ts:14-21` vs `:72-88`, `:47`, `:60`, `:130`, `:142`.)

**T2 — `invitedBy` does not exist on the wire.** It is stored and written on
every invite, but no mapper emits it and no populate fetches it
(`member.controller.ts:14-21,72-88`; `member.actions.ts:51-52`). "Invited by
Amina" is not renderable. Neither is any invite timestamp other than
`createdAt`, and there is no "invite expires at" field on the member row — the
7-day TTL lives on a `Verification` document the API never returns
(`member.service.ts:23,58-64`).

**T3 — `GET /members` hides removed members, permanently, with no override.**
No `?status=` param exists; the filter is hard-coded
(`member.actions.ts:21-24`). So the em-dash fix in §6 will still show a dash
for anyone who has left, there is no "former staff" view to build, and there
is no `GET /members/:id` to resolve one by id either. Plan the fallback text
before you plan the join.

**T4 — `DELETE /members/:id` deactivates and `DELETE /roles/:id` destroys.**
The same verb on two sibling routes does opposite things: the member row
survives with `status: "removed"` and returns 200 with a body
(`member.service.ts:308`, `member.controller.ts:142`); the role document is
genuinely removed and returns 200 with **no `data` key at all**
(`role.actions.ts:29-32`, `role.controller.ts:45`). Neither is a 204. A
generic `handleDelete` that assumes an empty 204, or that assumes an item can
be undeleted, will be wrong on one of the two.

**T5 — `permissions` is required on `POST /roles` but the *model* defaults to
`[]`.** Omitting the key is a **422**, not an empty role
(`role.validation.ts:28` — no `.default()`; verified:
`{name:"X"}` -> `"expected array, received undefined"`). Send `permissions: []`
explicitly. Conversely `PATCH` with `{permissions: []}` is legal and strips the
role bare. And the array is **not de-duplicated** and is capped at **43
entries** — a UI that appends on every checkbox click without de-duping will
hit `"Too big: expected array to have <=43 items"` long before the user has
selected 43 distinct permissions.

Runner-up traps, in one line each:

- **The Owner preset is real, listed by `GET /roles`, and un-assignable.** It
  comes back in the dropdown data with `isPreset: true` and `permissions:
  ["*"]`, and selecting it is a **403**, not a 422
  (`member.service.ts:43-45`). Filter it out of any role picker client-side.
- **The three presets are un-editable and un-deletable** (403 `"Built-in roles
  cannot be changed"`), and a custom role cannot be *named* `owner`/`manager`/
  `seller` in any casing (409). Read `isPreset` (or `!isCustom`) to decide
  whether to render the edit affordances.
- **`GET /roles` is not paginated and has no `meta`** — unlike `GET /members`.
  Do not reuse `apiGetList` for it.
- **Validation precedes auth on all nine routes**, so an anonymous smoke test
  with a bad payload returns **422**, not 401 — three tests depend on this
  (`pagination.test.ts:271-280`, `manage.test.ts:237-254`,
  `roles.test.ts:105-114`).
- **`GET /members` sorts oldest-first**, the opposite of `GET /sales`
  (`member.actions.ts:53`).
- **A 409 on `POST /roles` may or may not carry `code`.** Reserved-name is
  `code: "CONFLICT"`; a duplicate custom name comes from the unique index and
  has `errors.name` with **no `code`** (`error.middleware.ts:105-110`).
- **The empty-PATCH 422 for roles is filed under `_`**, not under a field
  name (`error.middleware.ts:12`).
- **A 429 on invite is the *business's* quota**, shared across both invite
  endpoints and all members, with a `Retry-After` header worth surfacing
  (`member.route.ts:74-79`, `rate-limit.middleware.ts:166`).
- **An invite whose email fails to send still returns 201**
  (`member.service.ts:76-82`). "Invitation sent" is not proof of delivery;
  offer Resend prominently.
- **`GET /auth/me` does not return your own member id**
  (`auth.controller.ts:94-107`) — match "this is me" on `user.id`.
- **Nothing here accepts an organization id**, in any path, body, query or
  header — `requireMember` resolves the tenant from the caller's own member
  row (`auth.middleware.ts:114-124`), and sending one in the invite body is
  silently stripped (`invite.test.ts:246-281`).

### Explicitly unverified

- **Self-demotion via `PATCH /members/:id`.** No guard exists in
  `changeMemberRole` and no test covers it. Read from source only — treat "a
  Manager can demote themselves and immediately lose the screen" as likely but
  unproven.
- **`role: null` on a `GET /members` row.** The mapper guards for it
  (`member.controller.ts:86`) but the API makes it near-unreachable, and no
  test produces it. Render defensively; do not design around it.
- **Ownership transfer.** No endpoint, no service, no writer of `ownerId`
  after creation. Absence confirmed by grep across `src`; if a product
  requirement needs it, it is a backend change, not a frontend one.
