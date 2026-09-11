# Slice 6 — permanently deleting a product, and one member's record

Two owner requests, built 2026-09-10. The API contract for both was designed here and implemented
in the backend in parallel; `docs/API-ROUTES.md` carries the final paths.

## 1. Delete is a second endpoint, not a change to the first

`DELETE /products/:id` **archives** — it has always archived, the design brief §9 requires the
control to say "Archive", and `useArchiveProduct` deliberately writes the response back into the
cache because the product goes on existing. Repointing that verb at a real delete would have been
invisible at the call site and destructive at the database.

So the real delete is `DELETE /products/:id/permanent`, and the two live side by side under the
same `products:delete` permission (which Sellers do not hold — see `PRESET_ROLES`).

**A URL typo between these two is the dangerous failure and no component test can see it.** Sending
a permanent delete to the archive path silently archives, which the user reads as success; sending
an archive to the permanent path destroys a product they meant to keep. `product.service.test.ts`
therefore asserts both URLs at the **axios adapter**, which is the only layer that sees a URL.

### The refusal, and where it is shown

`PRODUCT_HAS_SALES` (409, `details.saleCount`) once the product appears in any sale. A receipt
snapshots the item's name, unit and prices at the moment it was rung up and never reads the product
back, so **receipts survive the delete** — but the product's stock movements are the record of how
the stock got where it was, and deleting those under a receipt that still cites the product leaves
a sale nobody can account for. Archive is the answer for a product with history; delete is for the
one typed in by mistake.

The count goes **in the dialog, not in a toast** — it is the reason the answer is no, and a toast
would float it away from the button that earned it. Same call `features/categories` makes for
`CATEGORY_IN_USE`. Two smaller decisions in the same dialog:

- **The Delete button is withdrawn once the refusal arrives.** Pressing again cannot succeed — the
  product is exactly as sold as it was — and leaving it invites retrying instead of reading why.
  An unexpected failure (a 500) keeps the button, because that one genuinely is retryable.
- **A missing `saleCount` still explains itself.** `details` is whatever the server put there, so
  the count is checked rather than cast, and the prose falls back to a sentence that cites no
  number. The alternative renders "sold in undefined sales".

### Open, and one line to reverse

The backend implementer ruled that a **voided** sale still blocks the delete, and recorded it in
`../Backend/docs/FINDINGS.md` §1 for the owner. Worth knowing from this side: the frontend shows
whatever count the server sends and needs no change either way.

## 2. The member record

`GET /members/:id` did not exist. The list did, and `publicMember` — what all four *mutating*
member endpoints return — carries no `user` and no role name, so it cannot name a person. That gap
is the whole reason the endpoint had to be added rather than reusing an existing one.

The response is **one row of `GET /members`, exactly**, so the screen reuses `ListedMember` and no
second type exists to drift.

### Three things the screen deliberately does not show

All three were checked against `docs/findings/slice5-team.md` §2 rather than assumed:

| Wanted | Why it is absent |
|---|---|
| What this member has sold | Not fetchable from any member endpoint. The Staff report answers it for everybody at once. |
| Who invited them | `invitedBy` is stored on every invite path, but no mapper emits it and no populate fetches it. Not renderable at any price. |
| When a pending invitation lapses | The 7-day TTL lives on a `Verification` document the API never returns. |

### `/team/[id]` and the literal sibling

It sits beside the literal `/team/roles`. That is safe — Next resolves a literal segment ahead of a
dynamic one, so `/team/roles` keeps reaching the roles screen and never arrives as an id — but it
is the kind of thing worth stating, because the failure would be a working screen replaced by a
member-not-found.

**No `ROUTE_PERMISSIONS` row of its own.** `resolveRoutePermission` falls back to the longest
matching prefix, `/team`, and therefore to **`members:invite`** rather than `members:view`. That is
deliberate and matches `/team` itself: a Seller holds `members:view` so that a name can be resolved
on a receipt (`<MemberRef>`), not so they can open a colleague's record.

### The name is the link, not the row

`DataTable` supports `onRowClick`, and it is the wrong tool here: the member row already holds a
role `<select>` and an actions menu, and a row-level click target fights both. The name is the
link.

### The id trap, with a test on it

`MemberRowActions` takes `sessionUserId`, and it is the **user** id, not the member id — the two
are different rows and `canRemoveMember` compares against `user.id` to stop somebody removing
themselves. Passing the member id compiles, renders, and silently disables that guard, because the
two id spaces simply never match. Break-tested: swapping them reddens exactly one test.

### A 404 is "removed", not "error"

Removed members are excluded from the list permanently and there is no former-staff view anywhere
in this product, so an unknown id and a removed member are the same 404. Showing an error card
would leave somebody who had just removed a colleague wondering whether it worked. The screen says
they are not on the team and offers the way back.

## 3. Verification

`bunx tsc --noEmit` and `bunx biome check .` clean; 22 new tests. Break-tested, each reddening
exactly one test and nothing else:

| Guard inverted | Test that went red |
|---|---|
| Dress every failure as the sold-product refusal | `shows an unexpected failure as itself rather than as a refusal` |
| Pass the member id where the session user id belongs | `hands the actions the SESSION USER's id, not the member id` |
| Treat a 404 like any other error | `treats a 404 as removed rather than as an error` |
