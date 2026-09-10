# Reports — API contract

Extracted read-only from `Backend` (no edits made there). Every claim below is
`file:line` against that repo as of this read (2026-09-10). Chain traced:
`src/routes/v1/report.route.ts` -> `src/controller/report.controller.ts` ->
`src/services/reports/{period,shapes,sales.report,products.report,staff.report,debts.report,customers.report,dashboard.report}.ts`
-> the Mongoose models directly (this feature has **no `src/db/actions/` layer** —
every report calls `Model.aggregate(...)` from the service, unlike sales/debts).
Also read: `src/validators/report.validation.ts`, `src/validators/common.validation.ts`,
`src/lib/period.ts`, `src/lib/aggregation.ts`, `src/lib/money.ts`,
`src/middleware/{validate,error,auth}.middleware.ts`, `src/util/{errors,responses}.ts`,
`src/routes/v1/dashboard.route.ts` + `src/services/dashboard*`.

Tests read: `tests/integration/reports/{sales,products,staff-dashboard,debts,customers}.test.ts`
and the shared fixture `tests/integration/reports/seed.ts`.

---

## 0. The twelve routes and their shared chain

All twelve declare the same chain per-route, never `router.use(...)`
(`Backend/src/routes/v1/report.route.ts:33-37` explains why):

```
validate({ query, body: noBodySchema }) -> requireAuth -> requireMember
  -> requirePermission(PERMISSIONS.REPORTS_VIEW) -> handler
```

`PERMISSIONS.REPORTS_VIEW === "reports:view"` (`Backend/src/lib/permissions.ts:53`).
Mounted at `/reports` (`Backend/src/routes/v1/index.ts:43`), so the full paths are
`/api/v1/reports/...`.

| # | Path | Route | Query schema | Service |
|---|---|---|---|---|
| 1 | `GET /reports` | `report.route.ts:48-55` | `dashboardQuerySchema` | `getDashboard` |
| 2 | `GET /reports/dashboard` | `report.route.ts:57-64` | `dashboardQuerySchema` | `getDashboard` |
| 3 | `GET /reports/sales/summary` | `report.route.ts:66-73` | `salesSummaryQuerySchema` | `getSalesSummary` |
| 4 | `GET /reports/sales/trend` | `report.route.ts:75-82` | `salesTrendQuerySchema` | `getSalesTrend` |
| 5 | `GET /reports/sales/payment-mix` | `report.route.ts:84-91` | `paymentMixQuerySchema` | `getPaymentMix` |
| 6 | `GET /reports/products/top` | `report.route.ts:93-100` | `topProductsQuerySchema` | `getTopProducts` |
| 7 | `GET /reports/products/stock` | `report.route.ts:102-109` | `stockQuerySchema` | `getStockReport` |
| 8 | `GET /reports/products/dead` | `report.route.ts:111-118` | `deadProductsQuerySchema` | `getDeadProducts` |
| 9 | `GET /reports/staff/sales` | `report.route.ts:120-127` | `staffSalesQuerySchema` | `getStaffSales` |
| 10 | `GET /reports/debts/summary` | `report.route.ts:131-138` | `debtsSummaryQuerySchema` | `getDebtsSummary` |
| 11 | `GET /reports/debts/ageing` | `report.route.ts:140-147` | `debtsAgeingQuerySchema` | `getDebtsAgeing` |
| 12 | `GET /reports/customers/top` | `report.route.ts:149-156` | `topCustomersQuerySchema` | `getTopCustomers` |

**Trap 0 — validation runs before auth**, exactly as in `sales.md`. `validate` is
the first link (`report.route.ts:50,52`), so a bad query on an anonymous request
returns **422, not 401**. Every "anonymous caller gets 401" test in this suite
sends a *valid* query string (e.g. `debts.test.ts:151-154`,
`staff-dashboard.test.ts:127-130`). A smoke test that hits
`/api/v1/reports/products/stock?period=month` while signed out gets 422.

There is **no rate limiter** on any report route — `src/app.ts:12-57` mounts no
global limiter, and `report.route.ts` adds none. (The auth routes have their own.)

---

## 1. Query parameters — the period contract

### 1.1 The shared shape

Nine of the twelve spread `periodQueryFields` and wrap in `withPeriodRefinements`:

```ts
// Backend/src/validators/common.validation.ts:67-71
export const periodQueryFields = {
  period: z.enum(["today", "week", "month", "year"]).optional(),
  from: calendarDateSchema.optional(),   // /^\d{4}-\d{2}-\d{2}$/  (line 46)
  to:   calendarDateSchema.optional(),
};
```

```ts
// Backend/src/validators/common.validation.ts:78-87
schema
  .refine((q) => !(q.period && (q.from || q.to)), "Use either period or from/to, not both")
  .refine((q) => (q.from === undefined) === (q.to === undefined), "from and to must be given together")
```

Both refinements produce **422 `VALIDATION_ERROR`** (they fire inside
`validate`, `validate.middleware.ts:80`), not 400. Proven for
`sales/summary` (`sales.test.ts:84-89`), `customers/top`
(`customers.test.ts:99-104`) and `debts/summary` (`debts.test.ts:136-141`).

Every query object is `.strict()`, so **an unknown query param is a 422**, never
a silently-ignored key.

### 1.2 Which endpoint accepts what

| Endpoint | `period` preset | `from`/`to` | Extra params | Echoes `period` in the body? |
|---|---|---|---|---|
| `GET /reports` | yes | yes | — | **yes** |
| `GET /reports/dashboard` | yes | yes | — | **yes** |
| `GET /reports/sales/summary` | yes | yes | — | **yes** |
| `GET /reports/sales/trend` | yes | yes | `granularity` | **yes** |
| `GET /reports/sales/payment-mix` | yes | yes | — | **yes** |
| `GET /reports/products/top` | yes | yes | `by`, `limit` | **yes** |
| `GET /reports/products/stock` | **no — 422** | **no — 422** | **none at all** | no |
| `GET /reports/products/dead` | **no — 422** | **no — 422** | `days` only | no |
| `GET /reports/staff/sales` | yes | yes | — | **yes** |
| `GET /reports/debts/summary` | yes | yes | — | **yes** |
| `GET /reports/debts/ageing` | **no — 422** | **no — 422** | **none at all** | no |
| `GET /reports/customers/top` | yes | yes | `by`, `limit` | **yes** |

`stockQuerySchema` and `debtsAgeingQuerySchema` are literally
`z.object({}).strict()` (`report.validation.ts:33,61`) — *any* query string key
is a 422. Proven for ageing: `?period=month` -> 422
(`debts.test.ts:272-277`). `deadProductsQuerySchema` (`report.validation.ts:35-43`)
is `.strict()` with only `days`, so `?period=month` there is a 422 too.

Their controllers never call `resolveOrganizationPeriod` at all
(`report.controller.ts:63-67, 69-74, 94-98`), which is why they carry no
`period` echo.

### 1.3 Extra params, exact

| Param | Endpoint | Type | Default | Source |
|---|---|---|---|---|
| `granularity` | `sales/trend` | `"day" \| "week" \| "month"` | `"day"` | `report.validation.ts:15` |
| `by` | `products/top` | `"revenue" \| "quantity"` | `"revenue"` | `report.validation.ts:26` |
| `limit` | `products/top` | coerced int, **1..50** | `10` | `report.validation.ts:27` |
| `by` | `customers/top` | `"spend" \| "balance"` | `"spend"` | `report.validation.ts:70` |
| `limit` | `customers/top` | coerced int, **1..50** | `10` | `report.validation.ts:71` |
| `days` | `products/dead` | coerced int, **exactly 30, 60 or 90** | `30` | `report.validation.ts:37-42` |

`limit` max is **50**, not the list convention's 100 — `paginationQuerySchema`
is *not* used here. `limit=51` -> 422 (`customers.test.ts:78-83`,
`products.test.ts:71-72`); `limit=50` -> 200 (`customers.test.ts:85-90`).
`by=foo` -> 422 (`customers.test.ts:92-97`). `days=45` -> 422
(`products.test.ts:203-208`) — it is a `.refine()` on three literal values, not
a range.

There is **no `page`/`limit` pagination and no `meta`** on any report response.

### 1.4 `resolvePeriod` — confirmed against source

All three claims from the sibling `sales.md` contract are **confirmed**:

**(a) `to` is an INCLUSIVE calendar date.** `resolvePeriod` parses `to` as the
start of that local day and advances it by one day itself before handing back an
exclusive bound (`Backend/src/lib/period.ts:89-93`):

```ts
return {
  from: new Date(from.getTime()),
  to: new Date(addDays(toStart, 1).getTime()),   // period.ts:91
  timezone,
};
```

The doc comment at `period.ts:63-71` says so in words, and `PeriodInput.to` is
annotated `/** Calendar date "YYYY-MM-DD", inclusive. */` (`period.ts:22`). Every
report then filters `createdAt: { $gte: p.from, $lt: p.to }`
(`services/reports/shapes.ts:31`). **Send the last day you want to see.** A
client that adds a day itself over-selects by a full day.

Test corroboration: `from=2026-09-01&to=2026-09-03` returns three day-buckets
`2026-09-01 / 02 / 03` and `series.toHaveLength(3)`
(`sales.test.ts:159-173`) — the third day is included.

**(b) `MAX_PERIOD_DAYS = 366`** (`Backend/src/lib/period.ts:33`), enforced as:

```ts
if (differenceInCalendarDays(toStart, from) + 1 > MAX_PERIOD_DAYS)   // period.ts:86
  throw new BadRequestError(`Range cannot exceed ${MAX_PERIOD_DAYS} days`, "PERIOD_TOO_LONG");
```

Because of the `+ 1`, a span of **exactly 366 inclusive days passes and 367
fails**. Test: `from=2025-01-01&to=2026-06-01` -> 400 with
`code: "PERIOD_TOO_LONG"` (`sales.test.ts:91-99`). The cap applies **only to
`from`/`to`** — no preset can trip it.

**(c) Three 400-level codes exist and none is in the frontend's
`API_ERROR_CODE`.** Confirmed both sides — see section 8.

### 1.5 Defaults when nothing is sent

`resolvePeriod` falls through to `input.period ?? "month"`
(`Backend/src/lib/period.ts:97`). So **every period-taking endpoint called with
no query at all reports on the current calendar month, in the organization's
timezone**:

| `period` | `from` | `to` (exclusive, what the server computes) | Source |
|---|---|---|---|
| `today` | local `startOfDay(now)` | `+1 day` | `period.ts:98-101` |
| `week` | local `startOfWeek(now, { weekStartsOn: 1 })` — **Monday** | `+1 week` | `period.ts:102-105` |
| `month` (**the default**) | local `startOfMonth(now)` | `+1 month` | `period.ts:106-109` |
| `year` | local `startOfYear(now)` | `+1 year` | `period.ts:110-113` |

`month` is the **whole calendar month**, including days that have not happened
yet — not "the last 30 days" and not "month to date". Since a sale cannot be
created in the future the figures equal month-to-date, but `sales/trend` will
zero-fill buckets for the remaining days of the month. Same for `year`.

The timezone comes from the organization document, re-read per request
(`services/reports/period.ts:13-20`), default `"UTC"`
(`Backend/src/db/models/organization.model.ts:26`). It is never the browser's
timezone and is never client-settable on a report request.

### 1.6 The `period` echo

Nine endpoints append it in the controller:
`successResponse(res, "...", 200, { ...data, period: echoPeriod(period) })`
(`report.controller.ts:28,36,44,52,60,81,91,105`).

```ts
// Backend/src/services/reports/period.ts:23-27
{ from: p.from.toISOString(), to: p.to.toISOString(), timezone: p.timezone }
```

So the echo is **ISO-8601 instant strings, and `to` is the EXCLUSIVE bound** —
`?from=2026-09-01&to=2026-09-03` in `Africa/Nairobi` echoes
`to: "2026-09-03T21:00:00.000Z"` (local midnight Sept 4). Feeding `period.to`
back into a `to=` query param is wrong twice: wrong format (needs `YYYY-MM-DD`,
so it is a 400 `INVALID_DATE`) and, if truncated to a date, off by one day.
`period.timezone` is asserted as `"Africa/Nairobi"` in
`sales.test.ts:81`, `customers.test.ts:48`, `debts.test.ts:103`.

---

## 2. Response envelope

Every one of the twelve is `successResponse(res, "<message>", 200, data)`
(`Backend/src/util/responses.ts:31-45`):

```json
{ "success": true, "message": "Sales summary fetched", "data": {} }
```

No `meta` key on any report (`successResponse` omits it when `undefined`,
`responses.ts:42`). Messages, verbatim from `report.controller.ts`:
`"Dashboard fetched"` (both #1 and #2), `"Sales summary fetched"`,
`"Sales trend fetched"`, `"Payment mix fetched"`, `"Top products fetched"`,
`"Stock report fetched"`, `"Dead stock report fetched"`, `"Staff sales fetched"`,
`"Debts summary fetched"`, `"Debts ageing fetched"`, `"Top customers fetched"`.

### 2.1 The shared breakdown shape

Six endpoints return `{ items: BreakdownItem[] }`:

```ts
// Backend/src/services/reports/shapes.ts:14-20
interface BreakdownItem { key: string; label: string; value: number; share: number; [extra: string]: unknown }
```

Built by `toBreakdown` (`shapes.ts:55-62`): **sorted by `value` descending**, and
`share = round4(value / sum of values)`, `0` when the total is 0 — never a
division by zero. `round4` is 4 decimal places (`shapes.ts:48`).

**`share` is a fraction (0..1), not a percentage.** Multiply by 100 yourself.

**`share` is computed over the returned rows only, after `$limit`** — not over
the period's grand total. `customers.test.ts:47` proves it: Bea 80 and Ali 10
get `share` `0.8889` / `0.1111` (sum = 90), while total period revenue in the
same fixture is 199 (`sales.test.ts:70`). Labelling that "88.9% of revenue" is
wrong; it is "88.9% of the top-N shown".

### 2.2 Money and rounding

All money passes through `round2` (`Backend/src/lib/money.ts:18`) — **2 decimal
places, decimal units, never cents**. JSON drops trailing zeros, so `199` on the
wire means `199.00`. `share` and `marginPct` use `round4` (4 dp).

`grossProfit`, `profit` and `marginPct` **can be negative** (they are
`revenue - cogs`, `sales.report.ts:97,106,211`; `products.report.ts:36`).
Nothing clamps them at zero.

---

## 3. Endpoint by endpoint

### 3.1 `GET /reports/sales/summary`

`getSalesSummary`, `Backend/src/services/reports/sales.report.ts:49-113`.
Two aggregates in `Promise.all`: completed sales in `[from, to)`
(`shapes.ts:28-32`), and a separate voided-sales aggregate (`shapes.ts:41-45`).

```ts
{
  revenue: number,          // sum of Sale.total, round2            sales.report.ts:95
  salesCount: number,       // integer                              :98
  averageSale: number,      // round2(revenue/salesCount); 0 when count 0   :103
  cogs: number,             // sum of items.costPrice * items.quantity, round2  :96
  grossProfit: number,      // round2(revenue - cogs)               :97
  marginPct: number,        // round4(grossProfit/revenue); 0 when revenue 0  :106
  discountTotal: number,    // sum of (Sale.discount + line discounts), round2  :75,107
  collectedAtSale: number,  // sum of payment.amountPaidMain, round2  :77,108
  creditIssued: number,     // sum of payment.amountDue, round2       :78,109
  voidedCount: number,      // integer                               :110
  voidedAmount: number,     // sum of voided Sale.total, round2       :111
  period: { from: string, to: string, timezone: string }
}
```

**`marginPct` is a fraction despite the name.** `sales.test.ts:75` asserts
`toBeCloseTo(0.3769, 4)` for 75/199. Render as `marginPct * 100`.

**`voidedCount`/`voidedAmount` are matched on the voided sale's `createdAt`, not
its `voidedAt`** (`shapes.ts:41-45`). A sale rung up on Sept 1 and voided on
Oct 5 counts in September's void figures and in *none* of October's.

**Voids rewrite history retroactively.** `status` is the sale's *current* status,
so voiding an old sale removes it from that old period's `revenue`/`cogs`/
`salesCount` forever. Two identical requests a week apart can legitimately
disagree. Do not cache report responses as immutable.

Hand-computed fixture, `sales.test.ts:62-82`: revenue 199, salesCount 5,
averageSale 39.8, cogs 124, grossProfit 75, discountTotal 0, collectedAtSale 113,
creditIssued 86, voidedCount 1, voidedAmount 50. Note `revenue` counts a credit
sale at full `total` on the day of sale (`creditIssued` 86 of the 199 was never
collected) — **revenue is accrual, not cash**.

### 3.2 `GET /reports/sales/trend`

`getSalesTrend`, `sales.report.ts:167-215`.

```ts
{
  granularity: "day" | "week" | "month",   // echoed back, :214
  series: [{ bucket: string, revenue: number, cogs: number, profit: number, count: number }],
  period: { from, to, timezone }
}
```

Bucket key from `$dateTrunc` in the **organization's timezone** with
`startOfWeek: "monday"` (`sales.report.ts:180`), then formatted in JS
(`sales.report.ts:125, 200-205`):

| `granularity` | Bucket key format | Example |
|---|---|---|
| `day` | `yyyy-MM-dd` | `"2026-09-01"` |
| `week` | `yyyy-MM-dd` — **the Monday of that week** | `"2026-08-31"` |
| `month` | `yyyy-MM` | `"2026-09"` |

**`week` and `day` buckets are indistinguishable by shape.** Both are
`YYYY-MM-DD`. Only the request's `granularity` (echoed in the payload) tells
them apart.

`series` is **always zero-filled and always in ascending order** — labels are
walked from `truncateToBucketStart(p.from)` up to `p.to` regardless of data
(`walkBucketLabels`, `sales.report.ts:144-154`). Buckets with no sales are
`{revenue: 0, cogs: 0, profit: 0, count: 0}`. Proven:
`?granularity=day&from=2026-09-01&to=2026-09-03` -> exactly 3 buckets
(`sales.test.ts:172`); `?granularity=month&from=2026-08-01&to=2026-09-30` ->
`["2026-08", "2026-09"]` (`sales.test.ts:175-186`).

**With `week`/`month`, the first bucket label can pre-date `from`.** The walk
starts at the *truncated* start of `from`'s bucket, but the aggregation only
counts sales inside `[from, to)` — so `?granularity=week&from=2026-09-03&...`
emits a bucket labelled `2026-08-31` holding only Sept 3+ data. Label it as a
partial bucket; do not divide by 7.

`count` is sales, not line items — the two-stage `$group`
(`sales.report.ts:177-195`) collapses each unwound sale back to one row first.

Max series length is bounded by the 366-day cap: 366 day-buckets.

### 3.3 `GET /reports/sales/payment-mix`

`getPaymentMix`, `sales.report.ts:229-251`.

```ts
{
  byPaymentStatus: [{ key, label, value, share, count }],
  byCurrency:      [{ key, label, value, share, count }],
  period: { from, to, timezone }
}
```

- `byPaymentStatus`: `key = Sale.paymentStatus` (`"paid" | "partial" | "credit"`),
  `value = sum of Sale.total` (`sales.report.ts:234`).
- `byCurrency`: `key = Sale.payment.currency` (the ISO code **tendered at the
  counter**), `value = sum of Sale.payment.amountPaidMain` (`sales.report.ts:241`).

**The two arrays do not add up to the same total, by design.**
`byPaymentStatus` sums accrual revenue; `byCurrency` sums cash collected at the
till. Test: `byPaymentStatus` = 109 + 10 + 80 = 199 (= `revenue`) while
`byCurrency` = 113 (= `collectedAtSale`), both from the same 5 sales
(`sales.test.ts:190-207`).

**`byCurrency.value` is in MAIN currency even for an exchange-currency row.**
`amountPaidMain` is defined as main-currency (`sale.model.ts:26`), while `key`
is the tender currency. A row `{ key: "KES", value: 500 }` means "500 *USD*
worth of sales were tendered in KES", not 500 KES. There is no field carrying
the tendered amount here.

`label === key` — the raw enum/ISO code, no humanisation
(`sales.report.ts:248`).

**Neither array is zero-filled.** A period with no `credit` sales simply has no
`credit` row; a period with no completed sales gives `[]` for both. Build the
"paid/partial/credit" legend client-side.

`count` on a `byCurrency` row counts *sales*, including a pure-credit sale that
tendered 0 — the fixture's 5 sales include one with `amountPaidMain: 0` and the
single `USD` row still reads `count: 5, value: 113` (`sales.test.ts:205-206`).

### 3.4 `GET /reports/products/top`

`getTopProducts`, `Backend/src/services/reports/products.report.ts:19-56`.

```ts
{
  items: [{
    key: string,       // Product _id, 24-hex        products.report.ts:47
    label: string,     // items.name SNAPSHOT        :32,48
    value: number,     // round2(by === "revenue" ? revenue : quantity)  :49
    share: number,
    quantity: number,  // sum of items.quantity (raw, up to 3 dp)  :50
    revenue: number,   // sum of items.lineTotal, round2           :51
    profit: number,    // sum of (lineTotal - costPrice*quantity), round2  :52
  }],
  period: { from, to, timezone }
}
```

**`label` is the name frozen at the moment of sale, never the product's current
name** — the pipeline deliberately never `$lookup`s `Product`
(`products.report.ts:16-18`). Rename a product and last month's report keeps the
old name. That is correct behaviour, not a bug, but a UI that joins `key` to a
live product list will show two different names for the same row.

**`value` is `round2(quantity)` when `by=quantity`, but `quantity` is unrounded.**
Quantities carry up to 3 decimals for weighed goods
(`Backend/src/lib/money.ts:21,42-47`), so for a 1.005 kg total `value` is `1.01`
and `quantity` is `1.005`. Chart `quantity`, not `value`, when `by=quantity`.

`$sort: { [by]: -1 }` then `$limit: limit` (`products.report.ts:40-41`) —
**no tiebreak field**, so which of two equal-valued products survives the limit
boundary is not deterministic across runs. Do not build a stable "position
changed since yesterday" indicator on it.

Test: `by=revenue` -> labels `["C","A","B"]`, values `[160,30,9]`
(`sales.test.ts:211-222`); `by=quantity` gives a different ranking
(`products.test.ts:44-58`).

### 3.5 `GET /reports/products/stock`

`getStockReport`, `products.report.ts:80-133`. **Point-in-time. No query
parameters at all, no `period` echo.**

```ts
{
  trackedCount: number,   // count of active + trackStock products   :88,127
  stockValue: number,     // sum of quantity * costPrice, round2     :89,128
  retailValue: number,    // sum of quantity * sellingPrice, round2  :90,129
  lowStock:   [{ productId: string, name: string, quantity: number, threshold?: number }],
  outOfStock: [{ productId: string, name: string, quantity: number, threshold?: number }]
}
```

- Universe is `{ status: "active", trackStock: true }` (`products.report.ts:84`).
  Archived and untracked products are invisible here — proven
  (`products.test.ts:112-123`).
- `lowStock`: requires `lowStockThreshold` to **exist** and
  `quantity <= lowStockThreshold` (`products.report.ts:99-105`).
- `outOfStock`: `quantity == 0` (`products.report.ts:115`), threshold irrelevant.
- **A product can be in BOTH lists.** The fixture's C and D appear in each
  (`products.test.ts:104-109`). Never sum `lowStock.length + outOfStock.length`.
- A zero-quantity product with no threshold set is in `outOfStock` only.
- Both lists: `$sort: { quantity: 1, _id: 1 }`, `$limit: 50`
  (`products.report.ts:107-108, 116-117`). The 50 lowest, ascending, with a
  deterministic `_id` tiebreak — proven with 55 products
  (`products.test.ts:153-175`: length 50, quantities `0..49`, byte-identical on
  a repeat call).
- **`threshold` is absent from the JSON when the product has no
  `lowStockThreshold`** — `$project: { threshold: "$lowStockThreshold" }`
  (`products.report.ts:118`) emits no key for a missing field. It is `undefined`,
  not `null`. This can only happen on `outOfStock` rows (`lowStock` requires the
  field).
- **The key is `productId`, not `id`** — a deliberate deviation from the
  "ids on the wire are `id`" rule in `docs/API-ROUTES.md`. It serialises as a
  24-hex string (bson `ObjectId.prototype.toJSON` returns the hex string,
  `node_modules/bson/lib/bson.cjs:2817` on the class at `:2607`).
- Empty org: `trackedCount 0`, both values `0`, both lists `[]`
  (`products.test.ts:137-151`).

### 3.6 `GET /reports/products/dead`

`getDeadProducts`, `products.report.ts:145-191`. **No period; `?days=` only.**

```ts
{
  items: [{
    key: string,               // Product _id             :182
    label: string,             // product.name — LIVE, not a snapshot  :183
    value: number,             // === stockValue          :184
    share: number,
    quantity: number,          // current quantity        :185
    stockValue: number,        // round2(quantity * costPrice)  :173,186
    lastSoldAt: string | null, // ISO instant, or null if never sold  :187
  }]
}
```

Definition: active + `trackStock` + `quantity > 0` products whose last
*completed* sale line is older than `Date.now() - days * 86_400_000`
(`products.report.ts:149,163,172`), plus products **never** sold (`lastSoldAt`
`null` passes the filter).

- **The cutoff is a rolling wall-clock instant, not a calendar-day boundary and
  not timezone-aware** (`products.report.ts:149`) — unlike everything else in
  this feature. `days=30` means "in the last 720 hours", so the result shifts
  minute by minute.
- The `lastSoldAt` aggregate has **no period filter** (`products.report.ts:154`),
  so it is the true all-time last sale date.
- `label` here IS the live `Product.name` (this report reads `Product`
  directly), unlike `products/top` which uses the sale-time snapshot. **Two
  reports, two different name sources for the same product.**
- **Row caps:** `Product.find(...).limit(5000)` before any sort
  (`products.report.ts:163-165`) then `.slice(0, 50)` after sorting by
  `stockValue` desc with an `_id` tiebreak (`products.report.ts:174-180`).
  Past 5000 active in-stock tracked products, *which* 5000 are considered is
  Mongo's natural order — the report becomes silently incomplete with no signal
  in the payload.
- Test: with the fixture plus a never-sold product E, `items` is exactly `["E"]`
  with `quantity: 5, lastSoldAt: null`; product D is excluded because its
  quantity is 0 (`products.test.ts:179-201`).

### 3.7 `GET /reports/staff/sales`

`getStaffSales`, `Backend/src/services/reports/staff.report.ts:47-154`.

```ts
{
  items: [{
    key: string,          // MEMBER _id (not a User id)   staff.report.ts:147
    label: string,        // User.name, or "Removed member"  :148
    value: number,        // === revenue
    share: number,
    salesCount: number,   // completed sales where soldBy = member    :103
    revenue: number,      // sum of Sale.total, round2                :104
    profit: number,       // round2(revenue - cogs)                   :105
    voidsCount: number,   // voided sales where voidedBy = member     :109
    collected: number,    // sum of Payment.amountMain, receivedBy = member  :85,112
  }],
  period: { from, to, timezone }
}
```

Three independent aggregates merged in JS (`staff.report.ts:51-113`), so **a
member appears if they hit any one of the three** — a member who only took debt
repayments shows `salesCount: 0, revenue: 0` and a non-zero `collected`.

`label` comes from `Member -> $lookup users -> user.name`, falling back to the
literal string `"Removed member"` when `userId` is absent or the user row is
gone (`staff.report.ts:130-140, 144, 148`).

**`key` is a Member id, not a User id.** The signed-in user's id from
`/auth/me` will not match it; match against `member.id` (available as
`sections.me.memberId` on `GET /dashboard`, `dashboard/me.section.ts:16`).

`collected` counts **debt repayments only** — `Payment` records repayments and
never money taken at the till (`Backend/src/db/models/payment.model.ts:5-7`).
Cash taken during a sale is in `revenue`/`Sale.payment`, not here. In the
fixture the seller has `revenue: 169` and `collected: 6`
(`staff-dashboard.test.ts:69`).

`items` is **not** limited — `toBreakdown` sorts all of them by revenue desc, so
`share` here genuinely is each member's share of the org's total.

An invited-but-never-active member with no activity simply does not appear;
there is no zero row.

### 3.8 `GET /reports/debts/summary`

`getDebtsSummary`, `Backend/src/services/reports/debts.report.ts:40-110`.

```ts
{
  // POINT-IN-TIME — ignore the period entirely (debts.report.ts:30-33)
  outstanding: number,     // sum of remaining over status:"open"    :48,101
  openCount: number,       // count of status:"open"                 :102
  overdueAmount: number,   // sum of remaining where dueDate < now AND remaining > 0  :55-59,103
  overdueCount: number,    // same predicate, counted                :60-62,104
  // PERIOD-SCOPED — each keys off a DIFFERENT date field
  newDebt: number,         // sum of principal, any status, by Debt.createdAt  :68-74,105
  collected: number,       // sum of Payment.amountMain, completed, by Payment.createdAt  :75-81,106
  writtenOff: number,      // sum of writtenOffAmount, by Debt.writtenOffAt   :82-88,107
  cancelledAmount: number, // sum of principal, by Debt.cancelledAt           :89-95,108
  period: { from, to, timezone }
}
```

**Half the payload ignores the period it echoes.** The first four numbers
describe *right now*; changing `?period=` does not move them. A UI that puts all
eight under one "September" heading is lying about four of them.

`now` is `new Date()` captured server-side at request time
(`debts.report.ts:44`) — not the period's `to`.

`newDebt` counts a debt that was later cancelled or written off, because it was
still *issued* in that window (`debts.report.ts:33-36`).
`cancelledAmount` sums `principal`, not `writtenOffAmount`, because the void
path never writes a cancelled debt off (`debts.report.ts:36-39`).

Fixture: outstanding 80, openCount 1, overdueAmount 80, overdueCount 1,
newDebt 86, collected 6, writtenOff 0, cancelledAmount 0
(`debts.test.ts:92-102`); after a real write-off, `writtenOff` 80 and all four
point-in-time figures drop to 0 (`debts.test.ts:114-120`).

### 3.9 `GET /reports/debts/ageing`

`getDebtsAgeing`, `debts.report.ts:149-201`. **Point-in-time, no query params.**

```ts
{
  items: [
    { key: "current", label: "Current",            value, share, count },
    { key: "1-30",    label: "1-30 days overdue",  value, share, count },
    { key: "31-60",   label: "31-60 days overdue", value, share, count },
    { key: "61-90",   label: "61-90 days overdue", value, share, count },
    { key: "90+",     label: "90+ days overdue",   value, share, count }
  ],
  ordered: true
}
```

**This is the one breakdown in the whole feature that is NOT sorted by value.**
It bypasses `toBreakdown` and returns the five keys in the fixed order above,
always all five, always zero-filled — which is what the `ordered: true` flag
announces (`debts.report.ts:126-137, 189-200`). Render in array order; do not
re-sort. An org with no debts still gets 5 rows, all zeros
(`debts.test.ts:292-307`).

`value` is the sum of `remaining` over `status: "open"` debts; `share` is
`round4` of that over the five buckets' total.

**The `current` vs `1-30` split is `dueDate >= now`, not a day count**
(`debts.report.ts:171`). A debt overdue by one hour floors to `daysOverdue: 0`
but lands in `1-30`, never `current` — proven directly with four boundary debts
(`debts.test.ts:217-270`: `now + 1h` -> `current`, `now - 1h` -> `1-30`,
`now - 31d` -> `31-60`, `now - 91d` -> `90+`).

Ladder cutoffs are inclusive upper bounds: `<= 30` -> `1-30`, `<= 60` -> `31-60`,
`<= 90` -> `61-90`, else `90+` (`debts.report.ts:169-176`).

Relation to `debts/summary`: `items` covers *all* open debts, so the sum of
`value` equals that endpoint's `outstanding`, and the sum over the four overdue
buckets equals its `overdueAmount`. (Derived from the two `$match`es being
identical, `debts.report.ts:48` vs `:156`; not separately asserted by a test.)

### 3.10 `GET /reports/customers/top`

`getTopCustomers`, `Backend/src/services/reports/customers.report.ts:23-65`.

```ts
{
  items: [{ key: string, label: string, value: number, share: number }],
  period: { from, to, timezone }
}
```

`key` is the Customer id; `label` is `Customer.name` via `$lookup`
(`customers.report.ts:36-38, 49-51`). No `phone`, no other customer field.

| `by` | Source | Period-sensitive? |
|---|---|---|
| `spend` (default) | completed sales with `customerId` set, sum of `Sale.total` (`customers.report.ts:33-34`) | **yes** |
| `balance` | open debts, sum of `remaining` (`customers.report.ts:46-47`) | **no — point-in-time** |

**`by=balance` ignores the period completely** while still accepting and echoing
it (`customers.report.ts:14-22`, validator comment `report.validation.ts:63-65`).
The same screen showing a period picker next to a `by` toggle will silently make
the picker a no-op for one of its two modes.

**`by=spend` excludes walk-in sales** — the `$match` requires
`customerId: { $exists: true }` (`customers.report.ts:33`), so the sum of all
rows is less than `sales/summary.revenue`. Proven: Bea 80 + Ali 10 = 90 against
a period revenue of 199 (`customers.test.ts:36-49` vs `sales.test.ts:70`).

`by=balance` excludes a fully-paid debt (its status is no longer `open`) —
Ali disappears entirely (`customers.test.ts:63-74`).

`$sort: { value: -1 }` then `$limit` (`customers.report.ts:39-40, 52-53`) —
again no tiebreak.

**`label` can be missing from the JSON.** `$project: { label: { $arrayElemAt:
["$customer.name", 0] } }` emits no `label` key at all when the `$lookup`
returns an empty array, and nothing supplies an `$ifNull` fallback
(`customers.report.ts:38, 51`) — unlike `staff/sales`, which has an explicit
`"Removed member"` default. In practice customers are only ever **archived**,
never deleted (`customer.route.ts:60-67` maps `DELETE /customers/:id` to
`archiveCustomer`, and there is no `Customer.deleteOne` anywhere in `src/`), so
this should not fire. Treat `label` as `string | undefined` anyway — the cost is
one `??` and the failure mode is a blank row.

### 3.11 `GET /reports/dashboard`

`getDashboard`, `Backend/src/services/reports/dashboard.report.ts:37-90`.

```ts
{
  revenue: number,        // === sales/summary.revenue        dashboard.report.ts:80
  grossProfit: number,    // === sales/summary.grossProfit    :81
  salesCount: number,     // === sales/summary.salesCount     :82
  collected: number,      // round2(summary.collectedAtSale + payments in period)  :83
  outstanding: number,    // sum of remaining, open debts — POINT-IN-TIME  :51,84
  overdueAmount: number,  // sum of remaining where dueDate < now — POINT-IN-TIME  :52,85
  overdueCount: number,   // count, same predicate — POINT-IN-TIME    :53,86
  lowStockCount: number,  // countDocuments: active+tracked+threshold set+qty<=threshold  :66-72,87
  trend: [{ bucket: string, revenue: number, profit: number, count: number }],  // :88
  period: { from, to, timezone }
}
```

- `trend` is `getSalesTrend(..., "day")` **with `cogs` stripped**
  (`dashboard.report.ts:73, 88`). Same zero-filled `yyyy-MM-dd` buckets as 3.2,
  but only four keys per bucket and no `granularity` field. Granularity is
  always `day` — not configurable.
- **`collected` here is NOT `collected` on `debts/summary`.** This one is
  till cash + debt repayments; that one is debt repayments only
  (`dashboard.report.ts:83` vs `debts.report.ts:106`). Fixture: 119 vs 6
  (`staff-dashboard.test.ts:96` vs `debts.test.ts:100`).
- **`lowStockCount` is a true `countDocuments`, uncapped**
  (`dashboard.report.ts:66-72`), whereas `products/stock.lowStock` is capped at
  50. Above 50 low-stock products the two disagree, correctly.
- `overdueAmount`/`overdueCount` here omit the `remaining > 0` guard that
  `debts/summary` applies (`dashboard.report.ts:52-53` vs `debts.report.ts:57,61`).
  Since an open debt with `remaining: 0` should not exist, the two agree in
  practice — but the predicates are genuinely different source, so a data anomaly
  would surface as the two endpoints disagreeing. **Not covered by any test.**
- Four of the ten numbers (`outstanding`, `overdueAmount`, `overdueCount`,
  `lowStockCount`) ignore the period they sit next to.

Fixture: revenue 199, grossProfit 75, salesCount 5, collected 119,
outstanding 80, overdueAmount 80, overdueCount 1, lowStockCount 2
(`staff-dashboard.test.ts:84-105`).

### 3.12 `GET /reports` (the bare one)

**It is not an index and not a combined payload — it is a byte-for-byte alias of
`GET /reports/dashboard`.** Same validator, same `dashboard` controller
(`report.route.ts:48-55` vs `:57-64`). The route file's own comment explains it
(`report.route.ts:40-47`): the spec listed no bare `/reports`, but a router-root
test requires an anonymous caller to get 401 rather than 404, so the root was
pointed at the dashboard handler rather than left unmatched.

Proven: `GET /api/v1/reports?from=...&to=...` returns `data.revenue === 199`,
identical to `/reports/dashboard` (`staff-dashboard.test.ts:107-115`).

There is **no endpoint that lists the available reports.** Build the Reports
screen's navigation from a hard-coded list; nothing on the wire enumerates it.

---

## 4. Populated vs bare ids — the four ranked reports

**All four carry a human-readable name. Every one of these screens is
buildable without a second fetch.** But the name arrives as `label` on the
breakdown row, never as a nested `{ id, name }` object, and the four get their
names from four different places:

| Endpoint | `key` is | `label` source | Fallback | Missing-name risk |
|---|---|---|---|---|
| `customers/top` | Customer `_id` | `$lookup` `customers` -> `name` (`customers.report.ts:36-38, 49-51`) | **none** | key omitted from JSON if the lookup misses; no hard-delete path exists, so effectively never |
| `products/top` | Product `_id` | `Sale.items.name` — **snapshot at sale time** (`products.report.ts:32`) | n/a, always present (required field, `sale.model.ts:56`) | none |
| `products/dead` | Product `_id` | `Product.name` — **live** (`products.report.ts:183`) | n/a, always present | none |
| `staff/sales` | **Member** `_id` | `$lookup` `users` -> `User.name` (`staff.report.ts:123-140`) | `"Removed member"` | none — explicit fallback |

Corroborated by tests that assert on `label` directly: customer names
`["Bea","Ali"]` (`customers.test.ts:45`), product names `["C","A","B"]`
(`sales.test.ts:220`) and `["E"]` (`products.test.ts:199`), and staff labels
matched against `dataset.seller.user.name` / `dataset.owner.user.name`
(`staff-dashboard.test.ts:66-70`).

Two things a client still cannot get from these payloads: a customer's phone,
and a product's barcode/unit/category. Those need `/customers/:id` and
`/products/:id`.

`products/stock` rows carry `name` too (`products.report.ts:109,118`), so the
low-stock and out-of-stock tables are self-sufficient as well.

---

## 5. `GET /reports/dashboard` vs `GET /dashboard`

Two entirely separate features that happen to share a word — and, confusingly,
the identical success message `"Dashboard fetched"`
(`report.controller.ts:28` and `dashboard.controller.ts:10`).

| | `GET /reports/dashboard` | `GET /dashboard` |
|---|---|---|
| Route | `report.route.ts:57-64` | `Backend/src/routes/v1/dashboard.route.ts:14-21` |
| Permission | `reports:view` | **`organization:view`** — every member holds it |
| Query params | `period` / `from` / `to` | **none at all** (`noBodySchema` on the query, `dashboard.route.ts:16`) |
| Shape | flat metrics + `trend` + `period` | `{ available: string[], sections: Record<string, object> }` |
| Windows | caller's chosen period | hard-wired `today` + `month` + last-7-days, per section |
| Gating | all-or-nothing | per-section, permission-driven |

`GET /dashboard` composes a **section registry**
(`Backend/src/services/dashboard.service.ts:37-57`), running only the sections
whose `needs` the caller holds and listing exactly those keys in `available`, in
fixed registry order (`dashboard.service.ts:69-82`):

| Section key | Needs | Notes |
|---|---|---|
| `organization` | — | `{ id, name, logo, timezone, currency: { main, exchange, rate } \| null }` (`dashboard/organization.section.ts:13-21`) |
| `me` | — | `{ memberId, name, email, role: {id,name}, permissions }` (`me.section.ts:15-21`) |
| `announcements` | — | latest 3, pinned first (`announcements.section.ts:17-22`) |
| `mySales` | `sales:create` | own completed sales: today / thisMonth / recent 5 (`my-sales.section.ts:64-74`) |
| `sales` | `reports:view` | `today`, `thisMonth`, `trend7` — reuses `getSalesSummary`/`getSalesTrend` (`sales.section.ts:32-43`) |
| `debts` | `debts:view` | reuses `getDebtsSummary` + `dueWithin7Days` + 10 worst overdue **with customer name and phone** (`debts.section.ts:101-117`) |
| `stock` | `products:view` | reuses `getStockReport`, exposes 5 low-stock rows (`stock.section.ts:15-24`) |
| `staff` | `reports:view` + `members:view` | reuses `getStaffSales` for **today**, top 5 (`staff.section.ts:14-21`) |
| `projects` | `projects:view` | (`projects.section.ts:30-38`) |
| `team` | `members:view` + `members:invite` | `{ activeCount, invitedCount }` (`team.section.ts:15`) |

**Which is for the Reports screen: `GET /reports/dashboard` (or its alias
`GET /reports`).** It is the only one that honours the period picker, and it is
gated on the same `reports:view` as the other eleven, so it never 403s a user who
can already see the rest of the screen. `GET /dashboard` is the home screen — its
`sections.sales` is a fixed today/this-month/last-7-days card that deliberately
reuses the same service functions so the two screens can never disagree
(`dashboard/sales.section.ts:7-15`).

Note `sections.debts.overdue[]` is the **only** place in either surface that
returns customer `phone` alongside a debt (`debts.section.ts:110`) — the reports
endpoints never do.

---

## 6. Currency — where a client must get it

**No report payload carries a currency field. Not one of the twelve.** Every
`revenue`, `cogs`, `stockValue`, `outstanding`, `collected` and `value` is a
bare number in the organization's **main** currency (products store
`costPrice`/`sellingPrice` as main-currency, `product.model.ts:34-35`; debts and
`Payment.amountMain` likewise, `payment.model.ts:16`; `Sale.total` is main,
`sale.model.ts:28,38`).

The one exception in spirit is `payment-mix.byCurrency`, whose `key` is the
*tender* currency while its `value` is still main — see 3.3.

To render a currency symbol, fetch it from one of:

1. `GET /organizations/current/currency` (`organization:view`) ->
   `{ mainCurrency, exchangeCurrency, exchangeRate, updatedAt }`
   (`Backend/src/controller/organization.controller.ts:33-38`,
   route `organization.route.ts:86-93`).
2. `GET /dashboard` -> `sections.organization.currency` ->
   `{ main, exchange, rate }` (`dashboard/organization.section.ts:18-20`).

**The two shapes use different key names for the same three values**
(`mainCurrency`/`exchangeCurrency`/`exchangeRate` vs `main`/`exchange`/`rate`),
and #2 can be `null` when no config row exists. Pick one source and normalise it
once.
