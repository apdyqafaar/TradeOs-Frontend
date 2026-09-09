# Slice 2 · Task 6 — Product form

## `quantity` on a PATCH is destructured out and thrown away

**What:** `PATCH /products/:id` accepts `quantity` in the body and silently ignores it in every
case except one — `trackStock` flipping `false → true`. It is not a 422 and not a warning: the
request answers **200 with the product's stock unchanged**, which is the worst possible failure
mode for a number a shop trusts.

**Evidence:** `../Backend/src/services/product.service.ts:277-291`:

```ts
const { quantity: _quantity, images: newImageIds, ...rest } = input;
const data: Record<string, unknown> = { ...rest };
...
const flipsTrackStockOn = input.trackStock === true && existing.trackStock === false;
...
const initialQuantity = input.quantity ?? 0;
if (flipsTrackStockOn) data.quantity = initialQuantity;
```

`quantity` is renamed to `_quantity` and never reaches `data` unless `flipsTrackStockOn`
(`:285`, and the two assignments at `:291` and `:330` — the transactional path and the fast path).
The movement row is written only when `flipsTrackStockOn && initialQuantity > 0`
(`updateProductBody`, same file `:233`), so flipping tracking on with an opening count of `0` sets
the quantity but records no movement — correct, since nothing moved.

**So what:** the edit form renders **no quantity control at all** for an already-tracked product,
and renders **Opening quantity** only when the switch is moving `false → true`. A box that posts a
number the server discards is worse than no box. Stock moves through `POST /products/:id/stock`, a
sale, or a void — nothing else. `product-form.test.tsx` locks both halves of this.

## `useCategories()` returns a bare array, and `isDefault` is not "the General one"

**What:** two separate facts, both load-bearing for the category select.

1. `useCategories()` is `UseQueryResult<Category[]>` — a **bare array**, no `{ items, meta }`
   envelope. `GET /categories` is the one unpaginated list endpoint in this API.
2. `isDefault` does **not** identify the protected General category. It is `true` for all four
   categories seeded at organization creation (General, Food & Drinks, Household, Electronics).

**Evidence:** `features/categories/hooks/use-categories.ts` ("`Category[]`, not
`Paginated<Category>` … Callers map it directly; there is no `.items`") and the `isDefault` doc
comment in `features/categories/types.ts`, which quotes
`Backend/src/db/models/category.model.ts:20` — "True for the four seeded on organization creation;
informational only" — and notes that the protected one is identified by `key: "general"`, which
**is not on the wire**.

**So what:** the plan's instruction to default the select to "the `isDefault` category" would have
preselected **Electronics** on an alphabetically sorted list. The form deviates: on create the
select's first option is an empty-valued **"Default category"**, and choosing it omits `categoryId`
entirely — which `resolveProductCategoryId` on the backend resolves to General. That is the only
reliable way to land in General from a client. On edit the empty option is dropped, because the
product already has a category and PATCH has no way to say "put it back in the default".

## `<ImagePicker known={…}>` is mandatory on an edit form, and it is easy to miss

**What:** the gallery pane lists **unattached** uploads (`GET /uploads?attached=false`). Every
image already saved on a product is attached, so the ids in `value` resolve to nothing the picker
knows about and each renders as a numbered placeholder tile — reorderable and removable, but
blank. `known={product.images}` is what puts pictures in them.

**Evidence:** the `known` prop's doc comment in `features/uploads/components/image-picker.tsx`
("There is no `GET /uploads/:id` to fall back on"), and the merge order in the same file —
`known` is applied last into the `thumbs` map, so it wins over a stale gallery entry.

**So what:** `ProductForm` passes `known={product?.images}` unconditionally. The awkward part in a
form context is that `value` is `string[]` while `known` is
`{ uploadId, url, thumbUrl }[]` — two shapes for one list — so the form holds the ids in
react-hook-form and keeps `product.images` only as a lookup table. It also means the picker's
`onChange` must go through `setValue("images", ids, { shouldDirty: true })`; RHF cannot register an
array field that has no input element behind it.

## The mirrored ObjectId regex cannot validate a select's value, only reject the server's

**What:** `createProductSchema` types `categoryId` and `images[]` with
`/^[0-9a-fA-F]{24}$/`, mirroring the backend. Feed that schema to a form resolver and it fails on
any id the form did not invent — which is all of them.

**Evidence:** running `product-form.test.tsx` against a `productFormSchema` that kept the regex,
the "sends only the field that changed on an edit" case never called `useUpdateProduct().mutate`:
resolution failed on `categoryId: "c1"`, the fixture id the plan's own Task 6 snippet and the
mocked `useCategories()` both use. Nothing in the form is wrong; the id simply is not 24 hex
characters.

**So what:** the form's local schema overrides both fields to plain strings and keeps
`images.max(5)`. This is not a loosened rule, it is a rule pointed at the wrong party: a
`categoryId` can only ever come from an `<option>` this form rendered out of `GET /categories`, and
an image id only from an upload the API just minted, so the regex can never catch a person's
mistake — the only value it can reject is one the server handed us. Whether an id is *real*
(rather than well-spelled) is a question only the API can answer, and it does: 422
`CATEGORY_NOT_FOUND`, which the form maps onto the select. `product.schema.ts` is untouched; the
regex still guards anything that parses a payload directly.

## Margin is gross margin on the selling price, not markup on cost

**What:** the form shows `(sellingPrice − costPrice) / sellingPrice`, rendered as a percentage to
one decimal, plus the absolute per-unit gain in the organization currency beside it.

**Evidence:** `product-form.test.tsx` — "reads margin off the selling price, the way the canvas
does" — asserts `26.6%` for cost `9.10` / selling `12.40`. `3.30 / 12.40 = 26.6%`; the markup
reading, `3.30 / 9.10`, is `36.3%` and is what the same two numbers produce if you divide by the
wrong one. Artboard `2d` prints `26.6%`.

**So what:** percent **and** absolute, deliberately. The percent is the number the canvas shows and
the one a buyer compares across products; the absolute is the one that answers "what do I actually
make on this", and it needs no explanation of which denominator was used. The percent is hidden
entirely when the selling price is zero or absent — dividing by it would print `Infinity%` or
`NaN%` on a half-filled form — and turns red when the selling price is below the cost, because
selling at a loss is a thing the form should say out loud rather than render as a muted minus sign.

## A barcode cannot be cleared once set; a description can

**What:** asymmetry in the backend validator that a diffing edit form runs straight into.
`barcode` is `.min(4)` and has no `.nullable()`, so there is no value — not `""`, not `null` — that
a PATCH can send to remove one. `description` is `z.string().trim().max(2000).optional()`, so `""`
is valid and does clear it.

**Evidence:** `../Backend/src/validators/product.validation.ts:15-20` (`barcode`) and `:53`
(`description`) — both inside `productFields`, which `updateProductSchema` builds from.

**So what:** clearing the barcode box on an edit and pressing Save raises a form error against the
field — "A barcode can't be removed once it is set" — instead of sending a request that would be a
422, or worse, silently dropping the change. Clearing the description sends `description: ""` and
works. The same guard covers `lowStockThreshold`, which is `.optional()` with no null either: an
alarm can be changed but not unset from this form.

## A successful create lands on the list, not the new product — for now

**What:** `useCreateProduct` seeds `productKeys.detail(created.id)` specifically so that "create,
then open the new product" renders instantly. `ProductForm` does not do that: it pushes to
`ROUTES.products`.

**Evidence:** `app/(app)/products/[id]/page.tsx` does not exist — it is the plan's Task 7. Pushing
to `ROUTES.product(saved.id)` today renders a not-found immediately after a successful save.

**So what:** there is a `// TODO(slice: 2, task 7)` on `onSuccess` in `product-form.tsx`. Whoever
builds the detail page should change that one line and delete the comment; the cache seeding is
already waiting for it. `ProductForm` also takes an optional `onSaved(product)`, which is how the
detail page should mount it in edit mode rather than navigating at all.

## `PermissionGate` reads the session directly, so the form gates the picker with `useCan`

**What:** the plan says to wrap `<ImagePicker>` in `<PermissionGate permission={UPLOADS_CREATE}>`.
`PermissionGate` (`lib/auth/permission-gate.tsx`) calls `useSession()` itself and returns `null`
whenever `data` is undefined — including while the session query is in flight.

**So what:** in a unit test with no session mock that means the picker never mounts *and* a real
axios request fires into happy-dom for `/auth/me`. `product-form.test.tsx` mocks
`@/features/auth/hooks/use-permission` (`useCan`) and both upload hooks, which only makes sense if
the gate is `useCan(PERMISSIONS.UPLOADS_CREATE)`. The form uses `useCan`; the effect is identical
(a caller without the permission sees nothing) and the component stays testable without a session.
