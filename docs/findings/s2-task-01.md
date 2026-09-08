# Slice 2, Task 1 — Products data layer

## The plan's `Product` and `StockMovement` interfaces are both correct

**What:** Every field in the plan's Task 1 "Interfaces" block matches the controller's shapers
exactly — no field renamed, none missing, none invented. `Product` is `publicProduct` field for
field, including `category: { id, name } | null` and `images: { uploadId, url, thumbUrl }[]`;
`StockMovement` is `publicMovement` field for field, including the absence of `updatedAt`.

**Evidence:** `../Backend/src/controller/product.controller.ts:20-52`, read in full against
`features/products/types.ts`.

**So what:** Nothing to correct. Recorded because the brief asked, and because "we checked and it
was right" is worth knowing next time somebody wonders whether this block was ever verified.

---

## `createdBy` on a stock movement is an id string, so the movements table cannot name anyone

**What:** `publicMovement` does `createdBy: movement.createdBy.toString()` — a bare **member** id.
It is not populated to `{ id, name }` the way `author` is on a dashboard announcement, and there is
no `createdByName`. The plan's Task 7 asks the movements table for a **Who** column.

**Evidence:** `../Backend/src/controller/product.controller.ts:50`; contrast
`features/dashboard/types.ts`'s `DashboardAnnouncement.author`, which *is* an object because its
shaper populates it.

**So what:** Task 7 must resolve ids to names itself, from `GET /members` (`members:view`, which
every preset role including Seller holds — `docs/API-ROUTES.md`). One request for the page, then a
`Map<id, name>` — never one request per row. If that is judged too much for this slice, the honest
fallback is a muted em dash, not a truncated id.

---

## `PATCH /products/:id` silently resets `unit` to "pcs" and turns `trackStock` on

**What:** The backend's `updateProductSchema` is
`createProductSchema.omit({quantity:true}).partial().extend({...})`, and **Zod 4's `.partial()` does
not remove a `.default()`** — it wraps the default in the optional, so an absent key still produces
the default. Every "partial" PATCH body therefore arrives at the service carrying `unit: "pcs"` and
`trackStock: true`, and `validate` replaces `req.body` with that parsed object. Two consequences:

- A product sold in `kg` is reset to `pcs` by a PATCH that only renames it.
- An **untracked** product (a service, a fee) is flipped to tracked by a PATCH that omits
  `trackStock` — and `flipsTrackStockOn` then evaluates true, so `quantity` is written too.
- The `.refine(b => Object.keys(b).length > 0, "Nothing to update")` guard can never fire, because
  the parsed body is never empty.

**Evidence:** run against the real validator on 2026-09-08 (`bun`, importing
`../Backend/src/validators/product.validation.ts`):

```
PATCH {}                 -> {"success":true,"data":{"unit":"pcs","trackStock":true}}
PATCH {status:'active'}  -> {"success":true,"data":{"unit":"pcs","trackStock":true,"status":"active"}}
PATCH {name:'Renamed'}   -> {"success":true,"data":{"name":"Renamed","unit":"pcs","trackStock":true}}
```

Service code that then acts on it: `updateProductForOrg`,
`../Backend/src/services/product.service.ts:285` (`flipsTrackStockOn`).

**The backend already knows about this defect class and fixed it twice — products was missed.**
`announcement.validation.ts:7-20` and `project.validation.ts:6-22` both carry a file-header comment
describing exactly this ("zod still applies `.default(false)` to a genuinely-missing key even under
`.partial()`… the 'reject an empty update' refine below was vacuously true"), and both fix it the
same way: declare the fields in a shared object **without** defaults, add `.default()` only in the
create schema, and build the update schema from the un-defaulted shape. `product.validation.ts` was
never given that treatment. `customer.validation.ts` is not affected — its create schema has no
`.default()` at all, so its `.partial()` really is empty for `{}`.

**So what:** Two things, and the first is not optional.

1. **Every PATCH this frontend sends must include `unit` and `trackStock`, carrying the product's
   current values** — including the `{ status: "active" }` un-archive, which is otherwise the
   shortest possible route to corrupting a product. Task 6's full edit form does this naturally;
   any *partial* update added later (an inline rename, a row action, un-archive) does not.
   `useUpdateProduct` says so in its doc comment.
2. `features/products/schemas/product.schema.ts` deliberately diverges from its mirror here: `unit`
   and `trackStock` are re-declared in the update schema **without** their defaults, so what leaves
   the browser is only what the user changed. There is a regression test
   (`"sends only what changed — no default is smuggled into a PATCH"`). This does not fix the API,
   which re-parses and re-applies its own defaults — only the backend can fix that, by applying to
   `product.validation.ts` the pattern its own `announcement.validation.ts` and
   `project.validation.ts` already document. Until it does, rule 1 above is the whole defence.

---

## Two files in `.claude/skills/new-feature/templates/` do not work as written

**What:** Following the scaffolder literally produces a slice that does not compile and, separately,
one that silently sends no filters.

- `keys.ts.template` writes `keys.lists()` and `keys.details()`, but `createQueryKeys` returns
  `lists` and `details` as **readonly tuples**, not functions — `TS2349: This expression is not
  callable`. It also types the list params as an `interface`, which is not assignable to
  `QueryKeyParams = Record<string, unknown>`: TypeScript gives an implicit index signature to object
  *type aliases* and mapped types but never to an interface, since an interface can be reopened.
- `service.ts.template` writes `apiGetList<X>(BASE, params)`. The second argument is an
  `AxiosRequestConfig`, every field of which is optional, so passing the filter object there
  **type-checks and sends no query string at all**. A filtered list would quietly return page 1
  unfiltered — which reads as a broken filter, not as a bug.

**Evidence:** `bunx tsc --noEmit` on a faithful transcription reported four errors in
`features/products/keys.ts` and, at the same moment, the identical four in `features/customers/keys.ts`
— a parallel agent hit it independently, which is as good a reproduction as one gets. For the
service: `apiGetList(url, config)` at `lib/api/client.ts:337`. Correct call verified by running axios
with a stub adapter — `{ params: { page: 2, limit: 25, search: undefined, lowStock: "true" } }` →
`/api/v1/products?page=2&limit=25&lowStock=true`, and an all-`undefined` params object produces no
query string.

**So what:** Fix both templates (they are the canonical example, per CLAUDE.md — "if the architecture
changes, change them too"). In `features/products` the workarounds are: `lists: () => keys.lists`,
and `ProductListParams` declared as a mapped type over `PaginationParams` rather than an interface
(`Flat<T>` in `types.ts`, with the reason on it). Both are commented so nobody "tidies" them back.

---

## The list query is `.strict()`, so two obvious client habits are 422s

**What:** `listProductsQuerySchema` is strict, and two of its fields are narrower than they look.
`lowStock` is `z.enum(["true"])` — the string, never a boolean; a serialised `lowStock=false` fails
the enum. `search` is `min(1)` after trimming — and an empty search box is exactly what `nuqs` hands
back when a user clears it.

**Evidence:** `../Backend/src/validators/product.validation.ts` (`listProductsQuerySchema`) and
`common.validation.ts` (`searchSchema`); the strictness is enforced because
`validate.middleware.ts` defines an own `query` property from the parse result.

**So what:** `product.service.ts` owns the translation — `toListQuery` maps `lowStock: true` to the
string and drops an empty `search`. Filters go into the URL as the ergonomic types
(`lowStock?: boolean`), and exactly one place knows what the wire wants. Do not pass a
`ProductListParams` straight to axios from anywhere else.

---

## The Low stock tab cannot show a product that never had a threshold set

**What:** The `lowStock=true` filter is
`{ trackStock: true, lowStockThreshold: { $ne: null }, $expr: { $lte: ["$quantity", "$lowStockThreshold"] } }`.
A tracked product with **no** `lowStockThreshold` is excluded — at any quantity, including zero.

**Evidence:** `buildFilter`, `../Backend/src/db/actions/product.actions.ts:65-69`.

**So what:** Task 5's **Low stock** tab is "products below the alarm their owner set", not "products
running out". A shop that never set thresholds sees an empty tab while its shelves are empty. The
empty state should say so — something like *"No product is below its low-stock alert. Products with
no alert set are not counted."* — rather than the generic "Nothing here yet".

---

## `search` is a prefix match, or an exact barcode — never a contains

**What:** The list's `search` builds `new RegExp("^" + escapeRegex(term), "i")` against
`searchName`, OR'd with an **exact** `barcode` equality.

**Evidence:** `../Backend/src/db/actions/product.actions.ts:60-63`.

**So what:** Searching `rice` does not find `Basmati rice 5 kg`. That is the API's behaviour and not
something the frontend can paper over; Task 5's filtered-empty state should not promise otherwise,
and the placeholder is better as *"Search by name or barcode"* than *"Search products"*. A scanned
barcode typed into the same box does resolve — which is why one field covers both.

---

## Archiving a product is not a delete, and the barcode does not come free

**What:** Three behaviours that a "delete" mental model gets wrong:

- `DELETE /products/:id` responds **200 with the archived product**, not 204 — and it detaches and
  releases the images, so `images` comes back `[]`.
- `GET /products/:id` still returns an archived product; `GET /products/barcode/:code` does **not**
  (`findActiveProductByBarcode` filters `status: "active"`), so an archived product's barcode is a
  404 at the counter.
- The unique partial index on `{ organizationId, barcode }` does not care about status, so creating
  a new product with an archived one's barcode is `409 DUPLICATE_BARCODE`.

**Evidence:** `archiveProduct` in `../Backend/src/services/product.service.ts:365-393`;
`findActiveProductByBarcode` and the index in `product.actions.ts` / `product.model.ts:69-72`.

**So what:** `useArchiveProduct` seeds the detail cache with the returned product instead of calling
`removeQueries` — the row still exists and the detail page should keep rendering it with an
"Archived" badge, not flip to a not-found panel. It also invalidates the barcode branch, because a
cached scan would otherwise let the counter sell an archived product. And Task 6 should expect
`DUPLICATE_BARCODE` to be reachable even when no *visible* product holds that barcode; the message
under the field should not claim the code is free to reuse after archiving.

---

## A new product's first movement is an `adjustment`, not a `restock`

**What:** Creating a product with `quantity > 0` writes a movement of type **`adjustment`** with
`reason: "Initial stock"`. So does the `trackStock` false → true flip. There is no `opening` type.

**Evidence:** `INITIAL_STOCK_REASON` and `createProductBody`,
`../Backend/src/services/product.service.ts:75`, `:114-126`, `:233-246`.

**So what:** Task 7's movements table will show a brand-new product's opening stock as an
*Adjustment*. That is correct and should not be "fixed" by inventing a fifth pill; the reason column
already explains it.

---

## `STOCK_NOT_TRACKED` also means "this product is archived"

**What:** `adjustStock` refuses with one code for two conditions:
`if (product.status !== "active" || !product.trackStock)`.

**Evidence:** `../Backend/src/services/product.service.ts:409-411`.

**So what:** Task 7 must hide Restock/Adjust on an archived product rather than rely on the error,
because the message it would get back ("This product's stock is not tracked") is wrong for that
case. Branching on the code alone cannot tell the two apart.

---

## Deviation: a stock mutation seeds the detail cache rather than invalidating it

**What:** The task brief asked for three invalidations — lists, `productKeys.detail(id)`, movements.
`useStockMutation` invalidates the lists and the movements, and for the detail it calls
`setQueryData(productKeys.detail(id), product)` instead. It also invalidates the barcode branch, a
fourth cache the brief did not mention.

**Evidence:** `POST /products/:id/stock` answers `{ product, movement }` where `product` is the full
`publicProduct` shape — byte-identical to what `GET /products/:id` would return
(`../Backend/src/controller/product.controller.ts:125-139`).

**So what:** The outcome the brief wanted (the quantity is never stale after a restock) is met more
directly: the new number is on screen on the same frame with no second request, where invalidating
would discard the answer the server just gave and immediately re-fetch it — which the scaffolder's
own hooks template calls out as the thing not to do. The barcode invalidation is there because the
counter caches a scanned product, and after a restock that cached copy holds the old quantity.
