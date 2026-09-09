# Sales — API contract

Extracted read-only from `Backend` (no edits made there). Every claim below is
`file:line` against that repo as of this read. Chain traced: `src/routes/v1/sale.route.ts`
-> `src/controller/sale.controller.ts` -> `src/services/sale.service.ts` ->
`src/db/actions/sale.actions.ts` -> `src/db/models/sale.model.ts`, plus
`src/validators/sale.validation.ts`, `src/lib/money.ts`, `src/util/responses.ts`,
`src/util/errors.ts`. Tests read: `tests/integration/sales/create.test.ts`,
`list.test.ts`, `credit.test.ts`, `void.test.ts`.

All four routes share one middleware chain, declared per-route, never as
`router.use(...)` (`Backend/src/routes/v1/sale.route.ts:14-48`):

```
validate({ params?, query?, body }) -> requireAuth -> requireMember -> requirePermission(PERMISSIONS.X) -> handler
```

**Trap 0 — validation runs before auth.** Because `validate` is the first link,
a malformed body/query/params on an anonymous request returns **422**, not
401. The "anonymous caller gets 401" tests only pass because they send a
*valid* body (`Backend/tests/integration/sales/void.test.ts:205-212` sends a
well-formed `{ reason: "Anonymous" }`). A frontend that free-types an
unauthenticated smoke test with a bad body will see 422 and could wrongly
conclude auth is broken.

---

## 1. `GET /sales` (`sales:view`)

Route: `Backend/src/routes/v1/sale.route.ts:14-21`. Query schema:
`listSalesQuerySchema`, `Backend/src/validators/sale.validation.ts:38-49`.

```ts
z.object({
  ...paginationQuerySchema.shape,   // page, limit — see common.validation.ts
  ...periodQueryFields,             // period, from, to
  status: z.enum(["completed", "voided", "all"]).default("all"),
  paymentStatus: z.enum(["paid", "partial", "credit"]).optional(),
  customerId: objectIdSchema.optional(),
  soldBy: objectIdSchema.optional(),
}).strict()
```
then wrapped in `withPeriodRefinements(...)` (`sale.validation.ts:38`, refinement
defined `common.validation.ts:78-87`).

Exact query params:

| param | type / values | default | source |
|---|---|---|---|
| `page` | coerced int, ≥1 | `1` | `common.validation.ts:28` |
| `limit` | coerced int, 1..100 | `20` | `common.validation.ts:29` |
| `status` | `"completed" \| "voided" \| "all"` | `"all"` | `sale.validation.ts:43` |
| `paymentStatus` | `"paid" \| "partial" \| "credit"` | none (unset = no filter) | `sale.validation.ts:44` |
| `customerId` | 24-hex ObjectId string | none | `sale.validation.ts:45` |
| `soldBy` | 24-hex ObjectId string (a **Member** id, not a user id) | none | `sale.validation.ts:46` |
| `period` | `"today" \| "week" \| "month" \| "year"` | none | `common.validation.ts:68` |
| `from` | `"YYYY-MM-DD"` (calendar date, **not** a full ISO datetime) | none | `common.validation.ts:46,69` |
| `to` | `"YYYY-MM-DD"`, **inclusive** calendar day — send the last day you want to see | none | `lib/period.ts:89-93` |

Refinements: `period` and `from`/`to` are mutually exclusive (422 if both
given), and `from`/`to` must be supplied together (422 if only one)
(`common.validation.ts:82-87`; proven by
`Backend/tests/integration/sales/list.test.ts:155-159`). With neither given,
**no date filter is applied at all** — every sale regardless of age is
returned (`list.test.ts:161-171`). Because the whole query object is
`.strict()` (`sale.validation.ts:48`), an unknown query param is a 422, not a
silently-ignored key.

No `search` param exists for sales (unlike products/customers) — filtering is
only status/paymentStatus/customerId/soldBy/period.

Date filtering is resolved in the **organization's timezone**
(`sale.service.ts:340-347`, `resolvePeriod`), and filters on `createdAt`
(`sale.actions.ts:45-49`), not on any business/void date.

Sort order: `createdAt: -1, _id: -1` (`sale.actions.ts:59-60`) — newest first,
with `_id` (not `createdAt`) as the tiebreak for equal timestamps, so two
sales created in the same millisecond sort by descending `_id`, i.e. the one
created *later in real insertion order* first (`_id`'s embedded timestamp +
counter) — proven by `list.test.ts:189-208`.

### Response envelope

`paginatedResponse` (`Backend/src/util/responses.ts:52-61`), called from the
controller as `paginatedResponse(res, "Sales fetched", result.sales.map(publicSale), { page, limit, total })`
(`sale.controller.ts:70-74`):

```json
{
  "success": true,
  "message": "Sales fetched",
  "data": [ /* array of Sale, see §5 below */ ],
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 2 }
}
```

`meta` keys are exactly `page`, `limit`, `total`, `totalPages` — `totalPages`
is computed server-side as `Math.ceil(total / limit)`
(`responses.ts:60`), never sent by the client and never absent. This is
**not** a bare array — unlike `GET /categories`, which sends no `meta` at
all. Do not reuse the categories list-handling code path unmodified.

Proven by `Backend/tests/integration/sales/list.test.ts:173-187`
(`meta.total === 3`, `meta.page === 1`, `meta.limit === 2`, `meta.totalPages === 2`
for 3 sales at `?page=1&limit=2`).

---

## 2. `POST /sales` (`sales:create`)

Route: `sale.route.ts:23-30`. Body schema: `createSaleSchema`,
`sale.validation.ts:12-36`.

```ts
const saleItem = z.object({
  productId: objectIdSchema,
  quantity: quantitySchema,          // > 0, ≤ 3 decimals, ≤ 1e9 — no .default()
  unitPrice: moneySchema.optional(), // omit -> server uses product.sellingPrice
  discount: moneySchema.default(0),  // line-level discount, amount not percent
}).strict();

const createSaleSchema = z.object({
  customerId: objectIdSchema.optional(),
  items: z.array(saleItem).min(1).max(100)
    .refine(items => new Set(items.map(i => i.productId)).size === items.length,
            "One line per product"),
  discount: moneySchema.default(0),  // order-level discount, amount not percent
  payment: z.object({
    currency: z.string().trim().toUpperCase().length(3),
    amountTendered: moneySchema,      // required, no default
  }).strict(),
  dueDate: z.string().datetime().optional(), // FULL ISO datetime, not YYYY-MM-DD
  note: z.string().trim().max(500).optional(),
}).strict();
```

**`.default()` fields — the trap this project already shipped once (a
`.partial()` on a schema with `.default()` silently reset data on update).
This route has no `.partial()`, but the defaults still matter for what a
client must send:**

- `saleItem.discount` defaults to `0` when omitted (`sale.validation.ts:17`).
- top-level `discount` (order-level) defaults to `0` when omitted
  (`sale.validation.ts:29`).
- **There is no default on `payment.amountTendered`, `items[].quantity`,
  `items[].productId`, or `payment.currency`** — all four are required with
  no fallback. Omitting `amountTendered` is a 422, it does **not** default to
  the sale total (i.e. it does not assume a fully-paid cash sale).
- `unitPrice` has no default — it is `.optional()` with server-side
  substitution (`product.sellingPrice`) done in the **service**, not the
  schema (`sale.service.ts:153`), so it is `undefined` on the wire request,
  never `0`.

`moneySchema` (`common.validation.ts:33-35`, backed by `isMoney`,
`money.ts:34-39`): a finite non-negative number, ≤ 2 decimal places, ≤
`MAX_MONEY` (`1e12`). `quantitySchema` (`common.validation.ts:38-40`, backed
by `isQuantity`, `money.ts:42-47`): finite, **strictly positive** (`0` is
rejected), ≤ 3 decimals, ≤ `MAX_QUANTITY` (`1e9`).

`dueDate` uses `z.string().datetime()` — a **full ISO-8601 datetime string**
(e.g. `new Date(...).toISOString()`, as every test sends it —
`credit.test.ts:75-76`). This is a different format from the `from`/`to`
**query** params on `GET /sales`, which are bare `YYYY-MM-DD`
(`common.validation.ts:46`). Sending a bare date string for `dueDate` on
`POST /sales` will fail validation.

The body is `.strict()` — an unexpected top-level field (e.g. stray `total`)
is a 422 even if every other field is valid, proven by
`create.test.ts:370-378`. Same for each `saleItem` (`.strict()` at
`sale.validation.ts:19`).

### Server-side computation (not on the wire request)

From `sale.service.ts:132-278`:

- `unitPrice` (if omitted) <- `product.sellingPrice` (`:153`).
- `lineTotal = round2(unitPrice * quantity - discount)`, must be `≥ 0` or 422
  (`:155-158`).
- `subtotal = round2(sum of lineTotal)` (`:173`).
- `total = round2(subtotal - orderDiscount)`, must be `≥ 0` or 422 (`:174-175`).
- Currency rate resolution: `input.payment.currency` must equal the org's
  `mainCurrency` (rate `1`) or `exchangeCurrency` (rate =
  `CurrencyConfig.exchangeRate`, frozen at that instant) — any other code is
  422 (`resolveRateFrom`, `:52-61`).
- `tenderedMain = toMain(amountTendered, rate)`,
  `amountPaidMain = min(tenderedMain, total)`,
  `change = max(0, round2(amountTendered - fromMain(total, rate)))` (in the
  **tendered** currency, not main),
  `amountDue = round2(total - amountPaidMain)` (`:177-180`).
- `paymentStatus`: `amountDue === 0 -> "paid"`; `amountDue === total ->
  "credit"`; else `"partial"` (`:208-209`).
- If `amountDue > 0`: `customerId` is required (else 422, field key
  `customerId`) and `dueDate` is required (else 422, field key `dueDate`) and
  `dueDate` must not be before start-of-today in the **organization's**
  timezone (else 422, field key `dueDate`) (`:193-206`, re-checked inside the
  transaction at `createDebtForSale`, `:74-107`, as a safety net).
- A debt (`source: "sale"`, `principal = amountDue`) is created and its id
  attached back onto the sale as `debtId`, with `dueDate` copied onto the
  sale too (`:268-272`, `setSaleDebt`, `sale.actions.ts:83-89`).

### Response

`createdResponse` -> HTTP **201**, body `{ success, message: "Sale recorded", data: <Sale> }`
(`sale.controller.ts:58-62`, `responses.ts:47-48`). See §5 for the exact
`Sale` shape.

---

## 3. `GET /sales/:id` (`sales:view`)

Route: `sale.route.ts:32-39`. `params` validated against `idParamSchema`
(`common.validation.ts:10`: `{ id: objectIdSchema }`, 24-hex regex).

**An id that is not 24 hex chars is a 422** (fails `objectIdSchema`'s regex
before the handler ever runs), not a 404. A well-formed but non-existent, or
cross-tenant, id is a **404** `NOT_FOUND` (`sale.service.ts:334-337`,
`NotFoundError("Sale")`, `errors.ts:77-88`; cross-tenant proven by
`list.test.ts:217-226`, since `findSaleById` filters by `organizationId`
first, `sale.actions.ts:25-26`).

Response: `successResponse(res, "Sale fetched", 200, publicSale(sale))`
(`sale.controller.ts:77-83`) — `{ success, message, data: <Sale> }`, no
`meta`. A **voided** sale is still returned here with `status: "voided"` and
the void fields populated (`void.test.ts:189-203`) — voiding never deletes or
hides a sale.

---

## 4. `POST /sales/:id/void` (`sales:void`)

Route: `sale.route.ts:41-48`. `params`: `idParamSchema`. `body`:
`voidSaleSchema` = `z.object({ reason: reasonSchema }).strict()`
(`sale.validation.ts:51`), where `reasonSchema = z.string().trim().min(1).max(500)`
(`common.validation.ts:43`) — **`reason` is required**, empty/omitted is 422
(`void.test.ts:155-161`).

Server logic (`sale.service.ts:280-332`):

1. 404 `NOT_FOUND` if the sale doesn't exist (cross-tenant included).
2. 409 `SALE_ALREADY_VOIDED` if `sale.status !== "completed"` (`:288-290`) —
   **a voided sale cannot be voided again**; proven by
   `void.test.ts:143-153`. There is also a race-guard re-check after the
   transaction's guarded update returns null (`:324-326`) — two concurrent
   voids of the same sale can only ever produce one 200.
3. Inside a transaction: cancel the linked debt first
   (`cancelDebtForSale`, `:117-130`) — **before** touching stock, so a debt
   refusal aborts the whole void with stock untouched
   (`void.test.ts` via `credit.test.ts:276-328`). If the sale has a `debtId`
   and that debt is not `status: "open"` with `paid === 0`, refuses **409
   `DEBT_HAS_PAYMENTS`** (`sale.service.ts:123-129`, guarded update
   `debt.actions.ts:103-112`). A sale with no debt (fully paid at creation) is
   a no-op here.
4. Restores stock **only for items whose `trackStock` was `true` in the
   sale's own item snapshot** (`ISaleItem.trackStock`, frozen at sale time) —
   *not* the product's current/live `trackStock` flag. Confirmed both
   directions by test: untracked-at-sale-time-then-tracked-later is **not**
   credited back (`void.test.ts:99-119`), and tracked-at-sale-time-then-
   untracked-later **is** still credited back (`void.test.ts:121-141`).
5. A `StockMovement` of `type: "sale_void"` is written per restored line,
   `quantity` positive (`sale.service.ts:306-322`).
6. Sets `status: "voided"`, `voidedAt`, `voidedBy` (the acting Member's id),
   `voidReason` on the sale (`voidSaleById`, `sale.actions.ts:68-78`).

Response: `successResponse(res, "Sale voided", 200, publicSale(sale))` — HTTP
**200**, not 201 (`sale.controller.ts:85-92`).

Permission: `Seller` does **not** have `sales:void` (absent from the Seller
preset, `Backend/src/lib/permissions.ts:119-136` — Seller has
`SALES_VIEW`/`SALES_CREATE` only, not `SALES_VOID`); `Manager` and `Owner`
do. Confirmed by `void.test.ts:163-176` (Seller -> 403, Manager -> 200).

---

## 5. Response shape — `publicSale`

`Backend/src/controller/sale.controller.ts:10-47`. This is the exact object
every one of the four endpoints puts in `data` (list wraps it in an array).

```ts
{
  id: string;              // sale.id — the Mongoose `id` virtual, NOT _id (:11)
  number: string;          // "S-000123", per-org sequence, 6-digit zero-padded (:12; counter.actions.ts:55)
  customerId?: string;     // sale.customerId?.toString() — bare id string, never populated (:13)
  items: {
    productId: string;     // item.productId.toString() — bare id, never populated (:15)
    name: string;          // SNAPSHOT at sale time, not live product.name (:16)
    barcode?: string;      // snapshot (:17)
    unit: string;          // snapshot (:18)
    quantity: number;      // up to 3 dp (:19)
    unitPrice: number;     // snapshot / override, 2 dp (:20)
    costPrice: number;     // snapshot of product.costPrice, 2 dp (:21)
    discount: number;      // line discount, amount (not %), 2 dp, default 0 (:22)
    lineTotal: number;     // round2(unitPrice*quantity - discount) (:23)
    // NOTE: item.trackStock EXISTS on the stored document
    // (sale.model.ts:19,64) but publicSale does NOT emit it — it is not on
    // the wire at all. Do not expect it in the response.
  }[];
  subtotal: number;        // sum of lineTotal, 2 dp (:25)
  discount: number;        // ORDER-level discount, amount, 2 dp (:26)
  total: number;           // round2(subtotal - discount) (:27)
  payment: {
    currency: string;      // ISO 4217, the TENDERED currency (main or exchange) (:29)
    exchangeRate: number;  // 1 if currency === org main; else the frozen rate at sale time (:30)
    amountTendered: number;// in `currency` (:31)
    amountPaidMain: number;// in MAIN currency, min(toMain(tendered, rate), total) (:32)
    change: number;        // in `currency` (the tendered currency, NOT main) (:33)
    amountDue: number;     // in MAIN currency, total - amountPaidMain (:34)
  };
  paymentStatus: "paid" | "partial" | "credit"; // (:36)
  debtId?: string;         // sale.debtId?.toString() — bare id, set only when amountDue > 0 (:37)
  dueDate?: string;        // Date -> ISO string via JSON.stringify; present only on a credit/partial sale (:38)
  note?: string;           // (:39)
  status: "completed" | "voided"; // (:40)
  voidedAt?: string;       // ISO string (:41)
  voidedBy?: string;       // bare Member-id string, not populated (:42)
  voidReason?: string;     // (:43)
  soldBy: string;          // bare Member-id string, ALWAYS present, never optional (:44)
  createdAt: string;       // ISO string (:45)
  updatedAt: string;       // ISO string (:46)
}
```

**Nothing nested is a populated object.** `customerId`, every `items[].productId`,
`debtId`, `voidedBy`, `soldBy` are all bare id strings produced by
`.toString()` — never `{ id, name, ... }` sub-objects. If a UI needs the
customer's name or a product's live price on a receipt, it must either read
the line-item snapshot fields (`items[].name`/`barcode`/`unit`) which *are*
denormalized onto the sale, or issue a separate `GET /customers/:id` /
`GET /products/:id` call — there is no `?populate=` option on this route.

`soldBy` and `voidedBy` are **Member ids**, not User ids
(`CLAUDE.md`: "Attribution fields ... hold the Member._id, not the user id" —
confirmed on the wire by `create.test.ts:342-355`, which asserts
`soldBy === sellerMember.id`, not the signed-in user's id).

---

## 6. Money and quantity representation

From `Backend/src/lib/money.ts:1-47` and `Backend/CLAUDE.md`'s "Money is a
Number... rounded to 2 dp" rule:

- All money fields are **JSON numbers**, never strings, never integer minor
  units (no cents). Rounded to **2 decimal places** at every boundary via
  `round2` (half-away-from-zero, `money.ts:18`).
- Quantities are numbers with up to **3 decimal places** (`isQuantity`,
  `money.ts:42-47`) — for goods sold by weight/volume. `quantity` must be
  strictly `> 0`; `0` is rejected by the schema, not merely discouraged.
- `moneySchema` caps a single field at `MAX_MONEY = 1e12` (`money.ts:12`);
  `quantitySchema` caps at `MAX_QUANTITY = 1e9` (`money.ts:15`).
- There is exactly **one currency field that matters for arithmetic
  direction**: `payment.currency` is the currency the customer actually
  tendered in — either the organization's `mainCurrency` or its
  `exchangeCurrency` (`CurrencyConfig`, `currency-config.model.ts:3-13`).
  Every other money field on the sale (`subtotal`, `discount`, `total`,
  `payment.amountPaidMain`, `payment.amountDue`) is in **main currency**,
  regardless of what was tendered. Only `payment.amountTendered` and
  `payment.change` are in the tendered `currency`.
- `payment.exchangeRate` is the units-of-main-per-one-unit-of-exchange rate,
  **frozen on the sale document at creation** — later changes to
  `CurrencyConfig.exchangeRate` never retroactively alter a past sale
  (proven twice: `create.test.ts:188-203` for a main-currency sale,
  `credit.test.ts:330-361` for an exchange-currency credit sale). This
  matches the frontend's documented "Money direction" finding
  (`Frontend/CLAUDE.md`): converting exchange -> main **multiplies** by
  `exchangeRate`. `toMain`/`fromMain` are `money.ts:28,31`.
- An exchange-currency tender shows up as: `payment.currency = "KES"` (say),
  `payment.exchangeRate = 0.0078` (a real fixture value used throughout the
  tests, `credit.test.ts:33-41`), `payment.amountTendered` in KES,
  `payment.amountPaidMain`/`amountDue`/`subtotal`/`total` all in USD (main).
  There is no separate "amountTenderedMain" field — only `amountPaidMain`.
- Line-level `discount` and order-level `discount` are **amounts, not
  percentages**, both money-typed, both default to `0` when omitted.

---

## 7. Error codes

All errors go through `AppError` subclasses (`Backend/src/util/errors.ts`)
and are exposed on the wire as `{ success:false, message, code, errors?,
details? }` (`responses.ts:63-79`). **Branch on `code`, never `message`** per
`Frontend/CLAUDE.md`.

| HTTP | `code` | Condition | Evidence |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | No session cookie | `errors.ts:38-42`; every test file's "anonymous caller gets 401" |
| 403 | `FORBIDDEN` | Caller's role lacks the route's permission (e.g. Seller calling void) | `auth.middleware.ts:164-168`, `errors.ts:44-56`; `void.test.ts:163-176` |
| 404 | `NOT_FOUND` | Sale/Product/Customer id doesn't exist **or belongs to another org** (tenant scoping makes cross-tenant indistinguishable from missing) | `errors.ts:77-88`; `create.test.ts:270-293` (unknown & cross-tenant product), `list.test.ts:217-226` (cross-tenant sale), `create.test.ts:357-368` (cross-tenant customer) |
| 422 | `VALIDATION_ERROR` | **Generic** — every zod schema failure, AND every hand-thrown `ValidationError` in the service (unsupported currency, duplicate product line, negative line total, discount exceeds subtotal, missing `customerId`/`dueDate` on a partial/credit sale, past `dueDate`, empty void `reason`, unknown top-level body field). **All of these share the same `code`** — the service never passes a distinct `code` to `ValidationError`, so a frontend must branch on the **`errors` map's field key** (e.g. `errors.customerId`, `errors.dueDate`, `errors["payment.currency"]`, `errors.items`, `errors.discount`), not on `code`, to tell these apart. `sale.service.ts:58-60,83,86,92,157,175,195,198,204`; `sale.validation.ts` (zod) | `create.test.ts:213-242,270-318`; `credit.test.ts:193-231` |
| 409 | `PRODUCT_ARCHIVED` | A line item's product `status !== "active"` | `sale.service.ts:150-152`; `create.test.ts:270-280` |
| 409 | `INSUFFICIENT_STOCK` | Guarded stock decrement fails for a tracked line (`quantity < requested`) — `details: { productId, requested, available }` | `sale.service.ts:217-226`; `create.test.ts:244-268` (exact `details` shape asserted) |
| 409 | `CUSTOMER_ARCHIVED` | `customerId` given but that customer's `status !== "active"` | `sale.service.ts:184-186`; `credit.test.ts:233-245` |
| 409 | `SALE_ALREADY_VOIDED` | Voiding a sale whose `status !== "completed"` (already voided) | `sale.service.ts:288-290,324-326`; `void.test.ts:143-153` |
| 409 | `DEBT_HAS_PAYMENTS` | Voiding a sale whose linked debt already has a payment recorded (`paid !== 0`) | `sale.service.ts:117-130`, guard `debt.actions.ts:103-112`; `credit.test.ts:276-328` |

Two conditions are **only distinguishable by HTTP status + presence of a
sale, not by `code`**: "product id not found" and "product belongs to
another org" both surface as a bare 404 `NOT_FOUND` with no `details` —
there is no `PRODUCT_NOT_FOUND` vs `PRODUCT_CROSS_TENANT` split.

---

## 8. Side effects

- **Stock.** Only products with `trackStock: true` move at all — untracked
  products (e.g. services) never touch `StockMovement` or `Product.quantity`
  (`sale.service.ts:217`, filters `.filter(i => i.trackStock)`). A sale
  decrements atomically with a `$gte` guard (`decrementStock`,
  `product.actions.ts:111-121`) inside the same DB transaction as the sale
  insert and the `StockMovement` write — oversell is impossible, it fails
  409 `INSUFFICIENT_STOCK` instead of ever going negative. A void increments
  back with **no** `trackStock` filter on the update itself
  (`incrementStock`, `product.actions.ts:123-138`) — the decision of
  *whether* to credit was already made from the sale's own item snapshot,
  not the live product.
- **StockMovements.** One per tracked line per sale-create (`type: "sale"`,
  negative `quantity`) and one per restored line per void
  (`type: "sale_void"`, positive `quantity`), each carrying `quantityAfter`
  and `saleId` (`sale.service.ts:227-238,309-320`).
- **Debts.** A sale with `amountDue > 0` creates exactly one `Debt`
  (`source: "sale"`, `principal = amountDue`, linked via `sale.debtId` and
  `debt.saleId`) inside the same transaction (`createDebtForSale`,
  `sale.service.ts:74-107`). Voiding cancels that debt
  (`status: "cancelled"`, `remaining: 0`) **only if untouched** (`paid ===
  0`); otherwise the whole void is refused with 409 `DEBT_HAS_PAYMENTS`
  before any stock is touched. A cancelled debt keeps its original
  `principal` for record-keeping but zeroes `paid`/`remaining`/
  `writtenOffAmount` — it is explicitly **not** the same thing as a written-
  off debt (`Backend/CLAUDE.md`, "Cancelled ≠ written off").
- **Receipt numbers.** `S-000001`, `S-000002`, ... per organization
  (`Counter` model via `nextSequence`, `counter.actions.ts:29-52`), assigned
  **after** stock is successfully reserved and **inside** the transaction —
  a request that fails validation, stock-check, or currency/customer/dueDate
  checks never consumes a number (proven repeatedly: `create.test.ts:213-
  242`, `:244-268`; `credit.test.ts:193-231` all show the *next* successful
  sale still lands on `S-000001`). The sequence is described as "unique and
  increasing, **not gapless**" (`Backend/CLAUDE.md`) — `withTransaction` may
  replay its callback on a transient error, and `nextSequence`'s upsert-
  retry is not itself idempotent across a replay, so do not assume no gaps
  ever occur under contention; only assume monotonic increase and uniqueness.
- **Sales are immutable.** There is no `PATCH /sales/:id` and no "edit" path
  anywhere in this chain — the only state transition is `completed ->
  voided`, one-way, guarded so it can happen at most once.
- **A voided sale remains fully readable** — `GET /sales/:id` and `GET
  /sales?status=voided` both still return it with `status: "voided"` and the
  void metadata populated (`void.test.ts:189-203`).

---

## Top traps for a frontend developer

1. **`GET /sales` is `{ data, meta }`, not a bare array** — unlike
   `GET /categories`. `meta` is `{ page, limit, total, totalPages }`
   (`responses.ts:52-61`). Reusing categories' list-hook shape unmodified
   will silently drop pagination.

2. **`dueDate` on `POST /sales` needs a full ISO datetime string**
   (`z.string().datetime()`, e.g. `toISOString()`), while `from`/`to` on
   `GET /sales` need a bare `YYYY-MM-DD` calendar date. They look like "the
   same kind of date field" and are not interchangeable — sending one
   format where the other is expected is a 422.

3. **All 422s from this route share `code: "VALIDATION_ERROR"`.** There is
   no distinct code for "customer required for credit sale" vs "due date in
   the past" vs "unsupported currency" vs "duplicate product line" — the
   frontend must branch on the **`errors` object's keys**
   (`errors.customerId`, `errors.dueDate`, `errors["payment.currency"]`,
   `errors.items`, `errors.discount`), not on `code`, to show the right
   inline message.

4. **Nothing nested is populated.** `customerId`, `items[].productId`,
   `debtId`, `voidedBy`, `soldBy` are bare id strings, never `{id, name}`
   objects — including in the list response. A receipt/list UI needing a
   customer's name or a product's *current* price must fetch it separately
   or rely on the item's own snapshot fields (`name`, `barcode`, `unit` —
   *not* price, since `unitPrice`/`costPrice` are frozen sale-time
   snapshots, deliberately not "current").

5. **`change` is in the tendered currency; `amountDue`/`amountPaidMain`/
   `subtotal`/`total`/`discount` are all in main currency.** Mixing these up
   when tendering in the exchange currency (e.g. displaying `change` next to
   `total` as if same-currency) produces a nonsensical receipt. There is no
   `amountTenderedMain` field to shortcut this — convert with `exchangeRate`
   if a same-currency comparison is needed.

6. **A malformed `:id` (not 24 hex chars) is 422, not 404.** Only a
   well-formed id that doesn't resolve (including belonging to another
   organization) is 404. Don't build a "not found" screen keyed only on 404
   without also handling the 422 case for a garbled URL param.

7. **`items[].discount` and top-level `discount` both default to `0` when
   omitted** (`.default(0)`, `sale.validation.ts:17,29`) — but every other
   field in the create body (`amountTendered`, `quantity`, `productId`,
   `currency`) has **no default** and is a hard 422 if missing. Do not
   assume an omitted `amountTendered` means "pay in full."

8. **Validation runs before auth** in the middleware chain
   (`validate -> requireAuth -> ...`). A request with both a bad body *and*
   no session returns 422, not 401 — relevant for building a generic
   "session expired, redirect to login" interceptor keyed on 401 alone.

9. **A sale's `soldBy`/`voidedBy` are Member ids, not User ids.** If the UI
   already holds a signed-in user's id from `/auth/me`, it will not match
   `soldBy` directly — match against the caller's `member.id` instead.

10. **`items[].trackStock` is not on the wire at all**, even though it's
    stored server-side and drives void behavior. A frontend cannot infer
    from the sale response alone whether voiding it will restore stock for a
    given line — that determination is entirely server-side (based on the
    snapshot taken at sale time, which may since have diverged from the
    product's live `trackStock` flag).

---

## Corrections (2026-09-09, found while building `features/sales` against this file)

**1. `to` is an INCLUSIVE calendar date. The table above previously said exclusive.**
`resolvePeriod` parses `to` as the start of that day and then advances it itself before the `$lt`:
`to: new Date(addDays(toStart, 1).getTime())` (`Backend/src/lib/period.ts:89-93`). The `$lt` in
`sale.actions.ts` is real, but it applies to a bound the server has *already* moved. So a client
sends the last day it wants to see. **A frontend that "compensates" by sending `to + 1`
over-selects by a full day** — every "this month" filter would quietly include the first of the
next month.

**2. The error table has no 400 row, and `GET /sales` can emit three.** All three come from
`resolvePeriod`, all are `BadRequestError` → HTTP 400, and **none of them exists in the frontend's
`API_ERROR_CODE`** (`lib/api/errors.ts`), so they arrive unmapped:

| Code | Condition | Source |
|---|---|---|
| `INVALID_PERIOD` | `from` after `to`, or only one of the pair given | `period.ts:79,84` |
| `PERIOD_TOO_LONG` | range exceeds **366 days** (`MAX_PERIOD_DAYS`, `period.ts:33`). The test is `days + 1 > 366`, so exactly 366 passes and 367 fails | `period.ts:86-88` |
| `INVALID_DATE` | not `YYYY-MM-DD`, or not a real calendar date | `period.ts:51,58` |

The 366-day cap is documented nowhere else and makes a "last 2 years" range impossible. The same
three codes serve every report endpoint, so this is not sales-specific.

**3. `dueDate` needs a `Z` suffix specifically, not merely "a full ISO datetime."** Zod's
`.datetime()` defaults to `offset: false`, so `2026-09-21T12:00:00+03:00` is a 422 exactly as a
bare `2026-09-21` is. This bites because `TZDate.prototype.toISOString()` emits the offset form and
a `date-fns` `XXX` format string is the natural wrong choice. Build the instant, then serialise it
through a plain `Date`.

**4. `round2` is not "half away from zero" below zero**, whatever the comment in `money.ts` says.
`Math.round` breaks ties toward `+Infinity`, so `round2(-0.005)` is `-0` — which is **not** `< 0`
and therefore passes the server's own negative-total guard. Verified numerically against the real
function. Mirror the formula exactly; do not "fix" it.

**5. `GET /sales` has no `search` param and there is no `GET /sales/number/:number`.** The query
schema is `.strict()`. The design brief's "search by receipt number" cannot be built today.
