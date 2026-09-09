# Slice 3 — Sales data layer + cart store

Built `features/sales/` (types, keys, schema, service, three hooks) and the counter's cart store.
`docs/contracts/sales.md` was the authority and held up almost everywhere; the exceptions and the
things it does not cover are below, along with the decisions the plan was silent on.

---

## `to` on `GET /sales` is an **inclusive** calendar date — the contract says exclusive

**What:** The contract's §1 table says `to` is a `"YYYY-MM-DD"`, "**exclusive** upper bound (`$lt`,
not `$lte`)". That is true of the resolved *instant* and **false of the date a caller sends**. The
service adds a day before the query sees it, so `?from=2026-09-01&to=2026-09-03` returns sales made
on the 3rd. A frontend that trusts the table and compensates — sending `to = lastDay + 1` — silently
over-selects by a whole day, which on a daily takings screen means yesterday's money appearing in
today's figure.

**Evidence:** `../Backend/src/lib/period.ts:89-93`, in the `from`/`to` branch of `resolvePeriod`:

```ts
return {
  from: new Date(from.getTime()),
  to: new Date(addDays(toStart, 1).getTime()),   // <- the +1 day
  timezone,
};
```

Its own doc comment (`period.ts:63-70`) spells it out: *"a custom range of `from: "2026-09-01", to:
"2026-09-03"` (both inclusive calendar dates) resolves to … up to (exclusive) local midnight of
September 4th."* `sale.service.ts:341-346` passes the raw query strings straight to `resolvePeriod`
and hands the resolved instants to `buildFilter`, which applies `$lt` (`sale.actions.ts:48`). Both
halves of the contract's citation are individually correct; the conclusion drawn from them is not.

**So what:** `from` and `to` are both inclusive calendar dates from the caller's side. Documented on
`SaleListParams.to` in `features/sales/types.ts` so nobody re-derives it from the contract table. The
contract's §1 row should be corrected to "**inclusive** calendar date; resolved to an exclusive
instant one day later".

---

## `GET /sales` can answer **400**, and the contract's error table has no 400 row

**What:** `docs/contracts/sales.md` §7 enumerates 401, 403, 404, 409 and 422 and states that every
schema failure is a 422. Three date-range failures are neither — they are thrown from
`resolvePeriod`, *after* validation, as `BadRequestError` (HTTP **400**), with codes that appear
nowhere in the contract or in `lib/api/errors.ts`'s `API_ERROR_CODE`:

| Condition | HTTP | `code` |
|---|---|---|
| `from` is after `to` | 400 | `INVALID_PERIOD` |
| the range spans more than **366 days** | 400 | `PERIOD_TOO_LONG` |
| a date the regex passed but the calendar refuses (`2026-02-31`) | 400 | `INVALID_DATE` |

The 366-day cap is itself undocumented anywhere on the frontend side: **a "last 2 years" range on
the sales list is impossible**, and a year-boundary range of exactly 366 days is the largest that
works.

**Evidence:** `../Backend/src/lib/period.ts:83-88` and `:33` (`MAX_PERIOD_DAYS = 366`),
`:50-51` and `:57-59` (`INVALID_DATE`); `../Backend/src/util/errors.ts:32-36` (`BadRequestError`
→ 400 with an overridable code). Reached from `sale.service.ts:344`, which calls `resolvePeriod`
for any query carrying `period` or `from`.

**So what:** A date-range picker on the sales list needs a max-span guard, or its error state has to
handle a 400 whose `code` is not in the frontend's enum (it survives — `codeForStatus(400)` only
supplies a fallback when the envelope carries none, and these carry one — but `hasCode(error,
API_ERROR_CODE.X)` cannot be written against it, because there is no `X`). Adding
`INVALID_PERIOD` / `PERIOD_TOO_LONG` / `INVALID_DATE` to `API_ERROR_CODE` is a one-line change I
left alone: `lib/api/errors.ts` is outside the files this task owns, and the same three codes are
raised by every report endpoint, so it belongs to whoever builds the shared period picker.

---

## `round2` is **not** "half away from zero" below zero, and that decides whether a sale is accepted

**What:** `../Backend/src/lib/money.ts:18` documents itself as rounding "half away from zero". For
positive amounts it does. For negatives it does not: JavaScript's `Math.round` breaks ties toward
`+Infinity`, so `round2(-0.005)` is `-0`, and `-0 < 0` is **false**. The server's guard is
`if (lineTotal < 0) throw` (`sale.service.ts:156`), so a line whose true total is `-0.005` is
**accepted** and stored as `-0`, while `-0.006` is refused.

**Evidence:** run against the transcribed implementation (`features/sales/store/cart.test.ts`,
"reproduces the server's asymmetry at the negative boundary"):

```
round2(-0.005) -> -0    (-0 < 0 === false)
round2(-0.006) -> -0.01 (refused)
```

**So what:** `round2` in `features/sales/store/cart.ts` is a character-for-character transcription,
comment included, and the test pins the negative boundary specifically. The temptation is to "fix"
it to a symmetric `Math.sign(n) * Math.round(Math.abs(n) …)`; doing so would make the cart refuse a
sale the server accepts, i.e. correct arithmetic producing a wrong verdict. The rule for this file
is *agree with the server*, not *be right*.

---

## The `+ Number.EPSILON` in `round2` is worth a cent per line, routinely

**What:** Dropping it — writing the obvious `Math.round(n * 100) / 100` — changes the answer on
ordinary counter arithmetic, not on contrived input. Two real cases:

| line | true product | server `round2` | naive |
|---|---|---|---|
| `0.05` × `2.9` | `0.145` | **0.15** | 0.14 |
| `1.00` × `1.005 kg` | `1.005` | **1.01** | 1.00 |

A brute-force sweep over every 2 dp price from 0.01 to 50.00 against every 3 dp quantity from 0.001
to 9.999 found the divergence dense across the whole range — it is not a corner.

**And the *order* of rounding matters as much.** The server rounds each `lineTotal` and then rounds
their sum (`sale.service.ts:155,173`). Summing the raw products and rounding once is off by a cent
whenever two lines each land on a half: two lines of `0.25 × 0.5` are `0.13 + 0.13 = 0.26` the
server's way and `0.25` the shortcut's.

**So what:** Both are pinned by `cart.test.ts` with the naive result asserted alongside the correct
one, so a future "simplification" fails loudly and reads as a deliberate difference rather than a
typo. This is the whole reason the cart derives totals from a transcription instead of from
`toFixed`.

---

## `dueDate` needs a **`Z` suffix**, not merely a "full ISO datetime"

**What:** The contract (§2, trap 2) says `dueDate` is a full ISO-8601 datetime rather than a bare
`YYYY-MM-DD`. True, and incomplete: Zod's `datetime()` defaults to `offset: false`, so a
**UTC-offset** form is refused too. `2026-12-31T00:00:00+03:00` is a 422; `2026-12-31T00:00:00Z`
passes.

**Evidence:** verified against this repo's zod 4.5.4, both spellings:

```
z.string().datetime()  "…+03:00" -> false   "…Z" -> true
z.iso.datetime()       "…+03:00" -> false   "…Z" -> true
```

**So what:** The due-date picker must produce `date.toISOString()`. A `date-fns` `format(date,
"yyyy-MM-dd'T'HH:mm:ssXXX")` — a natural choice in a codebase that already formats dates in the
business timezone — emits the offset form and 422s on a field the user filled in correctly.
`sale.schema.test.ts` pins both directions, and `SaleTender.dueDate` says so at the point of use.

A second-order consequence worth stating: the server compares the parsed `dueDate` against
start-of-today **in the organization's timezone** (`sale.service.ts:200-205`). "Today" chosen in a
shop on UTC+3 at 01:00 local is `…T22:00:00Z` *yesterday* — still after that zone's local midnight,
so it passes. The comparison is instant-vs-instant and correct; it is only confusing to read.

---

## The design asks for a sales search the API cannot serve

**What:** Brief §6.4 lists "search by receipt number" among the sales-list filters.
`listSalesQuerySchema` has **no `search` param at all** — the filters are exactly `page`, `limit`,
`status`, `paymentStatus`, `customerId`, `soldBy`, `period`, `from`, `to` — and the object is
`.strict()`, so sending `?search=S-000123` is a 422 rather than an ignored key. There is also no
`GET /sales/number/:number`: `docs/API-ROUTES.md` has four sales rows and that is all of them.

**Evidence:** `../Backend/src/validators/sale.validation.ts:38-49`. Contrast
`product.validation.ts` and `customer.validation.ts`, which both carry `searchSchema`.

**So what:** `SaleListParams` deliberately has no `search` field, so the compiler refuses the
control rather than the server refusing the request. Three options for whoever builds the screen,
none of them free: drop the control; filter the *current page* client-side and label it as such
(misleading — it searches 20 rows, not the journal); or ask the backend for a `number` filter. The
third is the only one that delivers what the brief drew.

---

## A receipt cannot name anybody without extra requests

**What:** Nothing on a `Sale` is populated, and two of the bare ids are not the ids a UI already
holds. `soldBy` and `voidedBy` are **Member** ids, so they do not match the signed-in user's id from
`/auth/me`; resolving them to names needs `GET /members` (gated on `members:view`, which the Seller
preset does hold, so the counter can do it). `customerId` needs `GET /customers/:id`.

The line items are the exception and the reason the receipt works at all: `name`, `barcode` and
`unit` are **denormalised onto the sale** at sale time, so a product renamed or archived afterwards
does not corrupt an old receipt. `unitPrice` and `costPrice` are snapshots too — a receipt must
never be re-priced from `GET /products/:id`.

**So what:** Documented on `Sale` in `features/sales/types.ts`. A receipt screen needs a members
lookup and possibly a customer fetch; budget for two extra requests, and note that the sales *list*
has the same problem multiplied by the page size — the design's `soldBy` and customer columns want
one `GET /members` for the whole page plus one customer fetch per distinct customer, which is an
argument for showing `Walk-in` and a member name only, not a full customer record.

---

## Decision: omitting `unitPrice` defers the price to commit time

**What:** The brief for this task requires omitting `unitPrice` when it still equals the product's
selling price, because the server substitutes `product.sellingPrice` for an absent one
(`sale.service.ts:153`). Implemented. The consequence, which is not obvious: that substitution reads
the product's price **when the sale is committed**, not when the item was rung up. If someone edits
the price in another tab between the scan and the `Complete sale` tap, the server prices the line at
the new value and the cart displayed the old one.

**So what:** The window is seconds and the alternative is never omitting anything, which would make
the rule pointless. `CartLine.listPrice` is the snapshot that makes the comparison possible, and the
consequence is written into `buildSalePayload`'s comment. If it ever bites, the fix is to send
`unitPrice` unconditionally — one line, one condition removed.

---

## Decision: the schema mirror uses `.optional()` where the backend uses `.default(0)`

**What:** `saleItem.discount` and the order-level `discount` are `moneySchema.default(0)` on the
backend. Mirroring that literally would make the *frontend* schema materialise the key on every
parsed line, so `JSON.stringify` would put `"discount":0` on the wire for a line nobody discounted —
defeating the omission the task calls for, and re-creating the shape of the bug this repo already
shipped once (a `.partial()` over `.default()` silently resetting data).

**So what:** Both are `.optional()` here, with the reasoning in the schema and a test asserting the
key is absent from the serialised body rather than present-and-zero. An absent key and an explicit
`0` store the same value server-side, so nothing is lost.

---

## `cartIssues` exists because the two commonest 422s are invisible to a schema mirror

**What:** `createSaleSchema` mirrors `sale.validation.ts` faithfully and still cannot catch the two
rules that refuse most bad carts — `lineTotal >= 0` and `total >= 0`. Both are computed in the
backend **service** (`sale.service.ts:156-158`, `:175`) from numbers that are not in the request
body: the body carries a unit price, a quantity and a discount, never a line total. No amount of
zod fidelity reaches them.

**So what:** `cartIssues(contents)` in the store is the check for those two, and it is the reason
the cart can refuse an over-discounted line before spending a round trip. It reports every offending
line, where the server names only the first one it meets. `canSubmit` is necessary, not sufficient —
stock, currency, customer and due date remain the server's call.

---

## Decision: the cart holds no currency, and no derived totals

**What:** Two things the store deliberately does not contain.

**No currency.** `mainCurrency` / `exchangeCurrency` / `exchangeRate` are server state from
`useCurrencyConfig()`, and a copy parked in a zustand store is the "server state is React Query's"
rule broken in the one place where being stale prints the wrong currency on a receipt. The tender is
passed into `buildSalePayload` as a `SaleTender` argument instead.

**No derived totals.** `subtotal`/`total` are functions of the lines; a copy in the store is a copy
that goes stale behind an action that forgot to recompute it. `cartTotals(...)` is called during
render, which the React Compiler already memoises — and `useMemo` is banned in this repo for that
reason.

One zustand v5 detail this shape avoids: a selector returning a fresh object
(`(s) => ({ lines, orderDiscount })`) is reported as an infinite render loop, not as a wrong value.
`useCart()` therefore takes two stable selectors and composes the object *outside* the subscription,
so no call site needs `useShallow`.

---

## `GET /sales` defaults `status` to `"all"` — every other list in this app defaults to `active`

**What:** Products and customers default their status filter to `active`, so archived rows are
hidden until asked for. Sales default to `"all"` (`sale.validation.ts:43`), so **voided sales are
included** in an unfiltered list. The contract states it plainly; it is recorded here because the
sales list will be built by copying the products list, and the divergence is exactly the kind that
survives a copy-paste.

**So what:** `SaleListParams.status` carries the warning. A list that means "completed sales" has to
say so.

---

## A sale invalidates five caches, and one of them cannot be narrowed

**What:** `POST /sales` is the widest write in the app: it moves the sales journal, `Product.quantity`
plus a `StockMovement` per tracked line, a new `Debt` when anything is owed, that customer's
`debtSummary`, and the Overview's takings — all in one transaction. `use-sale-mutations.ts`
invalidates `saleKeys.lists()`, `productKeys.all`, `dashboardKeys.all`, and — only when the sale
carries a `debtId` — `debtKeys.all` and `customerKeys.detail(customerId)`.

`productKeys.all` is the blunt instrument on purpose: **`items[].trackStock` is not on the wire**
(contract trap 10), so the response cannot say which lines actually moved stock. The precise set is
unknowable client-side.

`customerKeys.lists()` is correctly left alone — the customer *list* endpoint returns no balance at
all, so a sale changes nothing on it.

**So what:** Both mutations share one `invalidateAfterSale` helper, because a void undoes exactly
what a create did and two copies of that list would drift. The half left behind would be the one
nobody notices: a stale cache is silent.

---

## Everything else in `docs/contracts/sales.md` checked out

Verified directly against the backend source while writing this slice, and found correct as
written: the `{ data, meta: { page, limit, total, totalPages } }` envelope and its `Math.ceil`
(`responses.ts:52-61`); `publicSale`'s exact field list and the absence of `trackStock`
(`sale.controller.ts:10-47`); every id being `id` and every reference bare; `soldBy`/`voidedBy`
being Member ids; the per-route middleware chain with `validate` first, so a malformed body on an
anonymous request is 422 rather than 401; a malformed `:id` being 422 while a cross-tenant one is
404; `amountTendered` / `quantity` / `productId` / `payment.currency` having no defaults; `.strict()`
on the body and on each item; the 409 codes and `INSUFFICIENT_STOCK`'s `details` shape; and the
service-side computation chain from `unitPrice` substitution through `paymentStatus`.
