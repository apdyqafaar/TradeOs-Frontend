# Slice 5 — Team (members & roles)

Built against `docs/contracts/team.md`, which is `file:line` against `Backend`.
Nothing in this slice re-derived an API claim; where this document disagrees
with the contract, the contract is right and this is stale.

**Verified 2026-09-10:** `bunx tsc --noEmit` clean, `bunx biome check` clean over
`features/team` and `app/(app)/team`, `bunx vitest run features/team` green —
97 tests across 11 files.

---

## What was built

```
features/team/
  types.ts                     ListedMember vs PublicMember, Role
  keys.ts                      memberKeys (+ directory), roleKeys
  schemas/member.schema.ts     invite, change-role
  schemas/role.schema.ts       create, update, permissionSet, isReservedRoleName
  services/member.service.ts   the five /members endpoints
  services/role.service.ts     the four /roles endpoints + assignableRoles
  hooks/use-members.ts         paginated list
  hooks/use-roles.ts           unpaginated list, `enabled` for roles:view
  hooks/use-member-directory.ts  all pages of /members, shared
  hooks/use-member-names.ts    ← the id→name lookup
  hooks/use-role-member-counts.ts  per-role counts, derived
  hooks/use-member-mutations.ts    invite, resend, change role, remove
  hooks/use-role-mutations.ts      create, update, delete
  lib/permission-catalog.ts    the matrix's 13 rows, derived from the mirror
  lib/member-rules.ts          owner / self / pending guards, labels, initials
  components/                  team-page, member-table, member-role-cell,
                               member-row-actions, remove-member-dialog,
                               invite-member-dialog, team-tabs, roles-page,
                               role-dialog, delete-role-dialog,
                               permission-matrix, role-summary
app/(app)/team/page.tsx        requirePageAccess + <ForbiddenScreen/>
app/(app)/team/roles/page.tsx  requirePageAccess + <ForbiddenScreen/>
```

`config/routes.ts` was **not** touched: `/team` on `members:invite` and
`/team/roles` on `roles:view` were already there and are deliberate.

---

## 1. The member-name lookup — `useMemberNames()`

`features/team/hooks/use-member-names.ts`. Four screens render an em dash where
a person's name belongs because their row carries a bare **Member** id. This
resolves it.

```ts
const names = useMemberNames();
names.resolve(sale.soldBy);   // string | null
names.display(sale.soldBy);   // string, falling back to UNKNOWN_MEMBER ("—")
names.isLoading;              // render a skeleton, not a dash
names.isError;                // 403 from a role without members:view
```

The join key lines up exactly — list rows are keyed by `member.id` and
`sale.soldBy` is a `ref: "Member"` id — so one query resolves every column.

### How it behaves for the two awkward cases

| case | resolves to | why |
|---|---|---|
| **Removed member** | `null` / `UNKNOWN_MEMBER` (`—`) | `GET /members` filters `status: { $ne: "removed" }` in the query itself. **There is no `?status=` override and no `GET /members/:id`.** A sale rung up by someone who has since left has no row to join against. The dash is the honest answer, not a gap. |
| **Pending member** (`user: null`) | `invitedEmail` | No `User` document exists until the invitation is accepted, so the address is the whole identity. In practice a pending member cannot appear as a `soldBy` — they cannot sign in — but they are rows in the members table itself. |
| **Re-invited former member** | their **real name** | Their row was updated in place and kept its `userId`, so it is `status: "invited"` **with** a populated `user` *and* an `invitedEmail`. `status === "invited"` does not imply `user === null`. |
| **A row with neither** | omitted from the map | Defensive; not reachable through any documented path. Omitted rather than stored as `""`, so `resolve` can never answer an empty string — a blank cell reads as a nameless person, a dash reads as an unknown one. |
| **No `members:view`** | `null`, `isError: true` | Every preset holds `members:view`, Seller included, so this is the narrow custom-role case. Nothing throws; the screens degrade to exactly what they did before. |

It walks **every page** (`limit: 100`, bounded by `meta.totalPages`, hard-capped
at 20 pages) rather than assuming one request is the whole directory. It shares
its query with `useRoleMemberCounts` under `memberKeys.directory()`, which sits
under the `lists` prefix so all four member mutations invalidate it — a lookup
that kept answering after somebody was removed would be worse than one that
stops.

### Which components should adopt it

**Not wired in** — three other slices' screens, deliberately left alone.

| file | field(s) | what changes |
|---|---|---|
| `features/sales/components/sale-table.tsx` — `<MemberRef>` (exported, also used by `features/sales/components/receipt.tsx` in two places) | `soldBy`, `voidedBy` | This is the highest-value adoption by far: one component, four call sites. It already keeps the id in `title` and renders `—`; adding `useMemberNames()` inside it makes the receipt read "by Amina Mohamed" as the canvas draws it, with the dash surviving for a removed member. Note `MemberRef` is currently used inside `receipt.tsx`, which is a print surface — check the query is warm before relying on it there. |
| `features/products/components/stock-movements-table.tsx` | `createdBy` | The "Who" column, same treatment. |
| `features/debts/components/payments-timeline.tsx` | `receivedBy` (and the voided-payment line) | "Received by —" becomes a name. |

**`features/product-import` cannot adopt it**, and this is worth recording
because the brief listed it: `use-import-jobs.ts` and `previous-jobs.tsx` do
render an em dash for an uploader, but `createdBy` **is never mapped onto the
wire** by the import job's public shaper (contract §5) — there is no id to join
against at all. The hook cannot help there; the fix would be a backend change.

`features/announcements` does not need it either: `author: { id, name }` comes
back populated on every read.

---

## 2. What the design asks for that the API cannot give

Four things, all from artboard `2j`.

1. **"Invited by"** — the classic members-table column. `invitedBy` is stored
   and written on every invite path, but **no mapper emits it and no populate
   fetches it**; it is absent from both member shapes. Not renderable at any
   price. No column was built for it.
2. **Invitation expiry** — a pending row cannot say when its link lapses. The
   7-day TTL lives on a `Verification` document the API never returns, and no
   member field carries it. The Joined column shows `Invited <date>` from
   `createdAt` instead, which is the only date the row has and is the closest
   honest proxy.
3. **A per-role member count on the roles list** — the design draws one;
   `publicRole` has no count field. It is **derived** in
   `useRoleMemberCounts()` from the members list, counting with exactly the
   predicate the server's delete guard uses (`status: { $ne: "removed" }`,
   invited members included), so the number beside a role and the 409 that
   refuses its deletion can never disagree. It is **omitted rather than shown as
   `0`** when the directory is unavailable — a confident `0` next to a Delete
   button that then 409s is the bug this guard exists to prevent.
4. **One Special column per row** — `members` holds **two** specials
   (`members:invite`, `members:remove`) and the drawn cell fits one 18px box.
   Rather than drop a permission, the Special cell renders one labelled control
   per special. `members` is the only row where more than one appears.

Plus two absences that shaped the members screen rather than a single cell:

- **No search box and no sortable column.** `GET /members` accepts `page` and
  `limit` under a `.strict()` schema — a `?search=` is a **422**, not an ignored
  parameter — and the sort is fixed at oldest-first. A client-side sort would
  reorder one page and lie about the rest.
- **No former-staff view.** Removed members are excluded from the list and from
  `meta.total`, permanently, with no override.

Also confirmed absent and deliberately not built: **ownership transfer**. There
is no endpoint, no service and no second writer of `ownerId` anywhere in the
backend. Do not add a UI for it.

---

## 3. Decisions worth knowing before touching this slice

**The two member shapes.** `GET /members` rows carry a populated `user` and
`role` and have no `roleId`; the four mutating endpoints answer `publicMember`
with a bare `roleId`, **no `user` at all**, and `role` on only two of the four.
Every mutation hook therefore **invalidates and never patches**. Splicing a
PATCH response into a row blanks the person's name; splicing a resend or a
remove also loses the role.

**Two deletes, opposite meanings.** `DELETE /members/:id` deactivates (row
survives, `userId` kept, sessions revoked, 200 with a body). `DELETE /roles/:id`
destroys (200, **no `data` key**). They are two service functions with different
return types (`PublicMember` vs `void`) on purpose; a generic delete handler
would be wrong on one of them. The member dialog never says "delete" and the
role dialog says the deletion is permanent.

**Owner is inferred from the role name, and that is sound.**
`Organization.ownerId` is not on the wire anywhere, so `isOwnerMember` matches
`role.name === "owner"` (trimmed, case-folded). It holds because the Owner
preset cannot be assigned to anybody (403), a custom role can never be *named*
`owner` (409, reserved), and the owner's row is created holding it. **If the
backend ever ships an ownership transfer, revisit `lib/member-rules.ts` first.**

**Self-demotion is allowed, because the API allows it.** There is no self-check
on `PATCH /members/:id` — the only guards are "not the owner" and "not to
Owner". So the role control is *not* hidden on your own row; hiding it would
invent a rule the server does not have. `useChangeMemberRole` invalidates
`authKeys.session()` unconditionally so the shell re-reads permissions, since
`GET /auth/me` returns no member id to compare against.

**The permission matrix is derived, not transcribed.** `PERMISSION_GROUPS` is
built from `lib/auth/permissions.ts`, the declared backend mirror the contract
verified has zero drift. Adding a permission to the mirror puts it in the matrix
with no second list to update. A test asserts 43 permissions in 13 groups and
that every one appears exactly once.

**Three cell states in the matrix, not two.** Granted, ungranted, and *does not
exist*: `payments` has no `view`, `uploads` has neither `view` nor `delete`
(`uploads:create` covers listing and deletion), `reports` has only `view`. Those
render as a muted rule with an `sr-only` explanation — an unticked box would
promise a permission that can never be granted.

**`permissions` is a `Set` throughout the form.** The backend does **not**
de-duplicate and caps the array at 43, so an append-on-click implementation
would hit "Too big" long before 43 distinct permissions were chosen.
`permissionSet()` de-dupes and re-orders into catalog order on the way out, so
two people ticking the same boxes in a different order send identical bodies.

**Two 409 shapes on `POST /roles`.** A reserved name is a service check with
`code: "CONFLICT"`; a duplicate custom name comes from the unique index with
`errors.name` and **no `code` key at all**. `role-dialog.tsx` reads both, because
reading only `code` shows nothing for the second.

**Resend reports through a toast — a considered exception** to "show the failure
where the action was taken". The action lives in a menu that closes on click, so
there is no control left to attach a message to; the same pattern is already
established for the app's other mail-sending action
(`features/auth/hooks/use-resend-verification.ts`). Removal, which has real
per-member refusals to explain, gets a dialog instead.

**`EMAIL_NOT_VERIFIED` gets its own panel, not the generic error banner.** It is
the only 403 in the system the caller can clear entirely on their own, and it is
a completely normal state for a brand-new owner. Branching on the code (never
the message) is mandatory — the backend's own comment says so.

**The 429 is the *business's* quota.** One bucket of 50/hour keyed on the
organization, shared between inviting and resending, spent by every member. The
invite dialog adds that sentence to the server's message, because the server's
message alone reads like a personal rate limit. The axios interceptor also
toasts on 429; the inline panel is additive.

**A 201 is not proof of delivery.** A mail send that fails is logged and
swallowed and the endpoint still answers 201/200. No copy in this slice promises
an inbox, and Resend is a first-class item on every pending row.

---

## 4. Unverified / left for later

- **The owner-by-role-name inference** (§3) is reasoned from three backend rules,
  not from a field. It is the one load-bearing inference in this slice.
- **`role: null` on a member row.** The mapper guards for it, the API makes it
  near-unreachable, and no backend test produces it. Rendered defensively
  (`"No role"`, and the row is excluded from role counts); not designed around.
- **A role held only by removed members can be deleted**, leaving those rows
  pointing at a role that no longer exists. Invisible here — removed rows are
  not listed — and it self-heals on re-invite, which always writes a fresh
  `roleId`. Reasoned from source in the contract; no test covers it.
- **The members screen was not driven in a real browser** against a live
  backend, unlike slices 2 and 3. The invite → accept → appears-as-active loop
  in particular has only been exercised against fixtures.
