# Slice 2, Task 7 — Product detail, stock card, movements, stock dialog

## The "Who" column has no name in it, and resolving one is a whole feature slice

**What:** `StockMovement.createdBy` is a bare **member id string** and nothing in the
`GET /products/:id/stock-movements` payload carries a name. The column renders an em dash with
`title="Recorded by member <id>"`, not a name and not a truncated id.

**Evidence:** `publicMovement` in `../Backend/src/controller/product.controller.ts:42-52` does
`createdBy: movement.createdBy.toString()` and shapes no user. The id refs `Member`, not `User`
(`../Backend/src/db/models/stock-movement.model.ts:17`, `ref: "Member"`). The only endpoint that
maps a member id to a person is `GET /members`, whose `listedMember`
(`../Backend/src/controller/member.controller.ts:72-88`) returns
`{ id, status, invitedEmail, joinedAt, createdAt, user: { id, name, email, image } | null, role }`.
`GET /auth/me` returns `user.id`, `organization`, `role` and `permissions` — **no member id**
(`features/auth/services/auth.service.ts:41-52`), so the session cannot even resolve the caller's
own movements to "You".

**So what:** turning names on is not a one-liner, and whoever does it should know the four costs
before starting.

1. **It needs files this task was not allowed to create.** The layering rule puts `useQuery` in
   `hooks/` and the URL in `services/`, so a name needs at least
   `features/members/{types.ts,keys.ts,services/member.service.ts,hooks/use-members.ts}`. Reaching
   for `apiGet` from inside a component to avoid that would be worse than the em dash.
2. **`GET /members` is paginated and defaults to 20 rows**, max 100
   (`DEFAULT_MEMBER_PAGE_SIZE` / `MAX_MEMBER_PAGE_SIZE` in
   `../Backend/src/validators/member.validation.ts:23-25`). A business with 30 staff resolves the
   first 20 names and em-dashes the rest unless the caller pages, and there is no
   `GET /members?ids=` to fetch just the handful a page of movements references.
3. **A removed member never resolves.** `findMembersByOrganization` filters
   `status: { $ne: "removed" }` (`../Backend/src/db/actions/member.actions.ts:21-24`), so the
   movements of someone who has left the business come back nameless *even with the lookup built* —
   which is exactly the audit trail a shop most wants to read.
4. **It is one extra request per product-detail view**, deduplicated by key, gated on
   `members:view` — which every preset holds, so it does not narrow who can open the page.

The em dash is the honest floor: it says "not known here" rather than inventing a name or printing
24 hex characters as if they were one. The id stays reachable in the `title` so an owner
investigating a discrepancy can still trace the row. When the members slice lands (Task for the
Members screen, artboard `2i`), swap the cell for a name and keep the em-dash fallback for cases 2
and 3 — they do not go away.

## Three things artboard `2d` draws that no data backs

**What:** the panel caption "last 30 days", the dashed `+` tile at the end of the image strip, and
the "Who" column above.

**Evidence:**

- **"last 30 days".** `GET /products/:id/stock-movements` validates its query with
  `paginationQuerySchema.strict()` — `page` and `limit` and nothing else
  (`features/products/services/product.service.ts`, and
  `productService.getStockMovements` in `../Backend/src/services/product.service.ts:451-460`). There
  is no date window to honour, and filtering 25 rows client-side would put a caption on a table
  that silently excluded older rows on the same page.
- **The `+` tile.** Images are attached through `<ImagePicker>` inside `product-form.tsx`. The
  detail screen has no upload flow and no draft to commit one to, so a tile there would either open
  a second picker whose save nothing applies, or do nothing.

**So what:** the caption reads `newest first`, which is what the endpoint actually guarantees
(`findStockMovementsByProduct` sorts `{ createdAt: -1, _id: -1 }`), and the strip shows only the
images that exist — Edit is the way to add one. If a real date filter is wanted, it is a backend
change to `stockMovementsQuerySchema`, not a frontend one.

## What a `sale_void` movement actually looks like on the wire

**What:** `{ type: "sale_void", quantity: +n, quantityAfter, saleId, createdBy, createdAt }` — a
**positive** delta, a `saleId`, and **no `reason` at all**. The void's own reason lives on the Sale
document, not on the movement.

**Evidence:** `voidSale` in `../Backend/src/services/sale.service.ts:305-318` builds the row as
`{ productId, type: "sale_void", quantity: item.quantity, quantityAfter: updated.quantity, saleId, createdBy: voidedBy }`
— the `reason` argument the function received is written to the sale
(`voidSaleById(..., { voidedBy, voidReason: reason })`) and never to the movement. Two more details
in the same block: the credit is driven by the **sale's own `trackStock` snapshot**, not the
product's current flag, so a product whose tracking was switched off after the sale still gets a
`sale_void` row; and `incrementStock` deliberately omits the `trackStock` filter for that reason
(`../Backend/src/db/actions/product.actions.ts:123-138`).

**So what:** the "Reason / receipt" column shows the receipt reference for both sale types and never
a reason, and a `sale_void` on an untracked product is a real, reachable state — which is another
argument for the movements table being absent rather than empty for `trackStock: false`, since the
rows would exist but the card explaining them would not. The reference is rendered as
`Sale …<last 6>` plain text with a `// TODO(slice: 3)`: `/sales/[id]` does not exist, and the
movement carries the sale's **ObjectId**, not the receipt number the counter printed — there is
nothing in this payload that knows the latter.

## Yes, the restock preview can disagree with what the server does — and that is the safe direction

**What:** the `New quantity` line is `this page's quantity + the typed delta`, computed in the
browser. It can be wrong. It can never make the *write* wrong.

**Evidence:** `POST /products/:id/stock` sends a **delta**, never a total
(`adjustStock`, `../Backend/src/services/product.service.ts:400-449`), and the server applies it
with `$inc` against the row it holds, guarding a decrement with
`quantity: { $gte: quantity }` (`decrementStock`, `../Backend/src/db/actions/product.actions.ts:111-121`).
So if a sale lands between this page's last fetch and the submit:

- the preview shows a total that is off by the sale, but
- the recorded movement is still exactly the delta the user asked for, and
- `quantityAfter` on the returned movement is the truth, and `useStockMutation` seeds
  `productKeys.detail(id)` from the server's product — so the number corrects itself on the same
  frame as the write.

The one case where the disagreement is visible as a refusal: the dialog's below-zero guard compares
against the stale quantity, so an adjustment that *looks* allowed can still come back 409
`INSUFFICIENT_STOCK`. That is handled — the code is caught in `StockDialog` and shown under the
quantity field with copy that names the reason ("someone may have sold some since this page
loaded"). The reverse is also possible and is the mildly annoying one: an adjustment that would be
fine against the *current* stock can be blocked by the local guard because this page thinks there is
less. Both resolve by closing the dialog and letting the number refresh.

**So what:** do not "fix" this by fetching the product before submitting, and above all do not make
the endpoint take a total instead of a delta — the delta is what makes two people restocking the
same product at once add up instead of overwrite each other. The preview is a typo-catcher, not a
source of truth, and the code treats it that way.

## `<input type="number">` cannot express a signed adjustment on a phone

**What:** the quantity field is `type="text"` with `inputMode` switching between `decimal`
(restock) and `text` (adjustment), not `type="number"` like the equivalent fields in
`product-form.tsx`.

**Evidence:** an adjustment is a **signed** delta — the plan's own test types `-3` and `-100` into
this field — and `inputMode="decimal"` renders a keypad with no minus key on iOS. `type="number"`
additionally sanitises intermediate states (a lone `-` is not a valid number), so the value the
control reports while someone is typing a negative is not the value they are typing.

**So what:** every value goes through `parseQuantity` (a strict signed-decimal regex, so `"1e4"` and
`""` are not numbers) and then through `stockMovementSchema`, so nothing rests on the browser's own
sanitising. If a future field needs the same treatment, copy the pair — the regex without the schema
would drift from the backend's bounds.

## Two small deviations from the plan, both deliberate

**What:** (1) a **Restore** button on an archived product, which the plan and the canvas do not
mention; (2) the stock card scales `<StockBadge>` with a child selector rather than rendering its
own big number.

**Evidence:** (1) `updateProductSchema` accepts `status: z.enum(["active"])` and exists for exactly
this — `features/products/schemas/product.schema.ts`, and the backend rule it mirrors. Without it
"archiving is not deleting" (brief §9) is only half true: the archived filter on the list would be a
one-way door. (2) `stock-card.tsx` passes
`className="[&>span:first-child]:text-[34px] …"` so the badge's quantity carries the canvas's 34px
headline while the Low/Out pill keeps its own 11px.

**So what:** (1) is one `useUpdateProduct` call and no new endpoint; drop it if the owner would
rather archiving be irreversible from this screen, but say so explicitly. (2) has one visible
consequence: the **unit rides at the headline size with the number** instead of at the canvas's
13px, because `StockBadge` renders `formatQuantity(q, unit)` as a single string. The alternative was
re-deriving "at or below the threshold is Low, and Out beats Low" in this card — a rule that already
has to agree with the products table and with the backend's `lowStock=true` filter, and that reads
`Low` in the list and healthy on the detail page the first time the three drift. The pixel was the
cheaper thing to give up.

## Nuqs is now a hard dependency of the product detail tree

**What:** `StockMovementsTable` keeps its page in the URL (`?mvPage=`, `?mvLimit=`) through
`useQueryStates`, so **any** test that renders `<ProductDetail>` for a tracked product must wrap it
in an adapter or it throws.

**Evidence:** rendering it bare fails with nuqs's "missing adapter" error, the same failure
currently breaking `features/customers/components/customer-detail.test.tsx` (4 tests, another
lane's in-flight work). `NuqsTestingAdapter` from `nuqs/adapters/testing` is what fixes it:

```tsx
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
render(<NuqsTestingAdapter><QueryClientProvider …>…</QueryClientProvider></NuqsTestingAdapter>);
```

**So what:** the keys are `mvPage`/`mvLimit` and not `page`/`limit` on purpose — Slice 3 is likely
to put a second paginated list (this product's sales) on the same screen, and two lists writing
`?page=` would page each other. Keep the prefix convention for the next one.

## Loose end for the lead: `product-form.tsx` still routes a save to the list

**What:** `ProductForm`'s `onSuccess` carries
`// TODO(slice: 2, task 7): send them to ROUTES.product(saved.id) once app/(app)/products/[id]/page.tsx exists`
and pushes `ROUTES.products` instead. That page now exists.

**Evidence:** `features/products/components/product-form.tsx`, the `onSuccess` handler.

**So what:** one line, in a file this task was not allowed to touch. Creating a product and landing
on its detail page is the flow the TODO was written for. (The detail screen's own Edit passes
`onSaved`, so it never hits that branch.)
