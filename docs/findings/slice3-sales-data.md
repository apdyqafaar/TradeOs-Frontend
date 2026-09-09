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

---

# Slice 3 — the sales list, the receipt and the void flow

Built `features/sales/components/` (`sales-page`, `sale-table`, `sale-filters`, `receipt`,
`void-sale-dialog`) plus `app/(app)/sales/page.tsx` and `app/(app)/sales/[id]/page.tsx`, against the
corrected `docs/contracts/sales.md` and artboard `2b`. What the screens taught that the data layer
could not is below; the corrections above all held up in use.

---

## The canvas prints the exchange rate **inverted**, and copying it would misprice a receipt

**What:** Artboard `2b`'s payment card reads `Tendered KES 7,280` · `At rate 130.00 frozen` ·
`Paid USD 56.00`. Those three lines are only consistent if `130` means *KES per USD* — the inverse
of what `payment.exchangeRate` actually holds. With main currency USD and a KES tender the wire
value is `0.0077` (the contract's own example, §6: `payment.currency = "KES"`,
`payment.exchangeRate = 0.0078`, every other amount in USD), because the stored rate is **units of
main per one unit of exchange**.

**So what:** A developer who renders `At rate {payment.exchangeRate} frozen` to match the drawing
gets `At rate 0.0077 frozen` and assumes something is broken; one who "fixes" it by printing
`1 / exchangeRate` has re-created the money-direction inversion `CLAUDE.md` records shipping once.
The receipt therefore renders **no standalone rate row**. `formatExchange` supplies the tendered
figure's second line (`≈ USD 56.06 @ 0.0077`), which multiplies — the same direction as `toMain` —
and the word `frozen` is appended to it. The rate appears exactly as stored, in the one place where
its direction is unambiguous because the converted amount sits beside it.

The canvas is a reference, not a build input (`docs/design/README.md`). This is the first place in
this build where following it literally would have produced a wrong number rather than a wrong
colour.

---

## `payment.currency` is on the sale; the **main** currency is not

**What:** Every amount on a receipt except `amountTendered` and `change` is in the business's main
currency, and the sale document does not record what that was. The receipt reads it from
`useOrganization()`, which is the organization's main currency **today**.

**So what:** A business that changes `CurrencyConfig.mainCurrency` re-labels every historical
receipt with the new code while the numbers stay as they were. `exchangeRate` is frozen on the sale
precisely so a past sale cannot be re-priced; the currency *code* has no such protection, and there
is no field on `publicSale` that would give it one. Low likelihood, high consequence: the figures
would be right and the label wrong, on a document someone is disputing. The fix is a backend field
(`payment.mainCurrency`, frozen alongside the rate), so it is recorded here rather than worked
around.

---

## Three things artboard `2b` draws that the API cannot fill, and what each became

| The canvas draws | The API has | What shipped |
|---|---|---|
| `by Amina Mohamed` in the header | `soldBy`, a bare **Member** id; no members slice | `<MemberRef>` — a visible em dash, the id in `title`, and the full `Recorded by member <id>` as `sr-only` text. The same treatment as the "Who" column in `stock-movements-table.tsx`. |
| `Voided · duplicate scan` / `Amina Mohamed · 04 Sep 2026 · 09:12` | `voidReason`, `voidedAt`, and `voidedBy` as another Member id | The banner renders the reason and the timestamp for real; the person is the same `<MemberRef>`. |
| `Open debt D-000064` | `debtId` only — the debt's human number is not on the sale | The link says `Open debt`. Naming it would cost a second request for a caption. |

`<MemberRef>` is shared between the list and the receipt (exported from `sale-table.tsx`, the
lighter of the two modules) so the two cannot drift into disagreeing about how an unresolvable
attribution is drawn. It is the single point to change when a members slice lands: one component,
three call sites.

**The list's customer column has the same problem and got a different answer.** The receipt spends
one `GET /customers/:id` because it is one page about one sale; a list would need one request per
distinct customer per page turn, which is the cost the first half of this document argued against.
So the column states the fact it does have — a sale with no `customerId` is a **`Walk-in`**, and
that absence is itself meaningful on a disputed receipt — and a sale with one gets an em dash
carrying the id, with the receipt one click away holding the name, phone and address.

---

## Void is refused for two reasons and **neither can be predicted client-side**

**What:** The canvas disables the Void button with a tooltip when the API would answer
`DEBT_HAS_PAYMENTS`. Nothing on `publicSale` says whether the linked debt has been paid against —
that lives on the `Debt` — so a pre-disabled button would need a second request whose answer would
still be stale by the time it was clicked. `SALE_ALREADY_VOIDED` has the same shape: the sale on
screen says `completed` right up until someone else's tab voids it.

**So what:** The button is never disabled. It carries the *rule* as its `title`, and only when the
sale has a `debtId`, since the rule is meaningless otherwise. The actual 409 is rendered inside the
void dialog, which **stays open** on refusal. Both refusals are final and both need a decision
rather than an acknowledgement — void the debt's payment first, or accept that the sale is already
voided — which is why neither is a toast.

`DEBT_HAS_PAYMENTS` is checked before any stock is touched (`sale.service.ts:117-130` cancels the
debt first, inside the transaction), which is the only reason the copy can promise that nothing
moved. If the backend ever reorders that transaction, the copy becomes a lie.

---

## The 366-day cap needs a client guard, not just an error branch

**What:** All three 400s (`INVALID_PERIOD`, `PERIOD_TOO_LONG`, `INVALID_DATE`) are knowable before
the request: a half-filled range exists for as long as it takes to click twice, a reversed one until
the first date is fixed, and the 366-day cap is arithmetic.

**So what:** `rangeIssue(from, to)` in `sale-filters.tsx` is the client half, and `toSaleListParams`
drops an unusable range rather than posting a guaranteed 400 — the filter bar says so in a line
under the controls, because "showing every sale" is what the table is then doing. Two details worth
keeping:

- The span check is `end - start + 1 > 366` over **UTC epoch days**, parsed field by field through
  `Date.UTC` and compared back. `new Date("2026-02-31")` is March 3rd in some engines and
  `Invalid Date` in others; the round trip is what makes `INVALID_DATE` reproducible. Working in UTC
  days also keeps the arithmetic free of the reader's timezone and of any DST boundary between the
  two dates.
- The three codes are declared as `PERIOD_ERROR_CODE` **in the filters file**, not in
  `lib/api/errors.ts`, which this task did not own — and the same three are raised by every report
  endpoint. The local constant is a placeholder to delete when the shared period picker adds them to
  `API_ERROR_CODE`.

The inclusive `to` is pinned by a test that asserts `to=2026-09-30` goes out unchanged, with the
reason on it: a client that "compensated" with `to + 1` would put 01 Oct inside September, and
nothing on screen would show that the figure was wrong.

---

## The receipt holds its render until the currency **and** the timezone have landed

**What:** `useOrganization()` falls back to `currency: ""` and `timezone: "UTC"` while it loads, and
the currency is a second request (`GET /organizations/current/currency`) that the session does not
carry. On a list, rendering through the fallback costs a row that gains a currency code a beat
later. On a receipt it is different in kind: `223.75` with no code, or a timestamp that shifts an
hour once the shop's zone arrives, on a document someone is holding while disputing a charge.

**So what:** `<Receipt>` treats `organizationLoading` exactly like `isPending` and shows the
skeleton for both. A moment more of skeleton is the cheaper mistake. The list does the same one
notch less strictly — it dims on `isPlaceholderData` rather than blanking.

The customer lookup is deliberately **not** held to that bar: it is one panel, everything else on
the page comes from the sale itself, and a failed or forbidden lookup keeps the panel's shape and
says the name could not be loaded rather than taking the totals down with it.

---

## `status` defaulting to `"all"` is a filter that has to be *said*

**What:** The first half of this document flagged the divergence to watch for. In the UI it needed
more than a comment: an unfiltered sales list contains voided sales, and a struck-through row with a
struck-through total is the only thing telling the reader so.

**So what:** the status select's default option reads **"All sales"** rather than being blank;
`hasActiveFilters` treats anything other than `"all"` as filtered, so the filtered-empty state
offers "Clear filters" and names including voided sales as one of the things to try. `status` is
also always sent, unlike `paymentStatus`, because `"all"` is a real value the schema knows and
sending it keeps the request self-describing.

---

## What is still missing from these screens

- **Receipt-number search** (brief §6.4) — impossible without a backend `number` filter, as recorded
  above. No control is rendered, and `SALE_FILTER_PARSERS` has no `search` key, so adding one is a
  deliberate act rather than an accident.
- **A `soldBy` filter.** The API accepts it, but the control would be a picker over members this
  build cannot list. Left out. The parser for `customerId` **is** there, unrendered, so a customer
  page can deep-link "this customer's sales" without the list silently ignoring half its URL.
- **Print** is `window.print()` with `print:hidden` on the actions, the back link and the two
  in-card links. There is no print stylesheet; the browser's default over the receipt card is
  legible, and a real one belongs with whoever decides whether a thermal printer is in scope.

---

# The counter — `/sales/new`, artboard `2a`

Built `features/sales/components/counter/` (eleven files: the six panes the artboard draws, a
numeric cell, two pure modules for the tender arithmetic and the refusals, and `counter.tsx`) plus
`app/(app)/sales/new/page.tsx`. Everything below is something the contract, the canvas or the
existing pieces did not answer.

---

## The tender's arithmetic could not live in the cart store, so it is `counter/tender.ts`

**What:** `cartTotals` stops at `total`. Everything past it — `amountPaidMain`, `amountDue`,
`change`, `paymentStatus` — depends on *which currency the customer is paying in*, and the store
deliberately holds no currency ("the cart holds no currency", above). So the four lines after the
total have nowhere in `features/sales/store/` to go, and a component that computed them would be
exactly the thing the store exists to prevent.

**Evidence:** verified read-only against the backend rather than paraphrased from the contract,
because a cent here decides whether a sale becomes a debt:

```ts
// ../Backend/src/services/sale.service.ts:177-180
const tenderedMain   = toMain(input.payment.amountTendered, rate);
const amountPaidMain = Math.min(tenderedMain, total);
const change         = Math.max(0, round2(input.payment.amountTendered - fromMain(total, rate)));
const amountDue      = round2(total - amountPaidMain);

// ../Backend/src/lib/money.ts:28,31
export const toMain   = (amount, rate)     => round2(amount * rate);
export const fromMain = (amountMain, rate) => round2(amountMain / rate);
```

Two details a paraphrase loses. **`amountPaidMain` is a bare `Math.min`, not a re-round** — both
operands are already 2 dp and a third rounding is one the server does not do. And **`change` divides**
(`fromMain`), which is the only division in the whole chain and the reason `resolveRate` refuses a
zero or non-finite rate rather than trusting `hasExchange` to have excluded it.

**So what:** `counter/tender.ts` is that transcription, importing `round2` from the store rather than
writing a second copy of the server's rounding. `tender.test.ts` pins the exchange cases in both
directions of the same pair, including `13000 × 0.0077` (which is `100.10000000000001` raw and would
otherwise leave a cent owing on a bill that was settled exactly).

---

## `resolveRate` returns `null` rather than falling back to `1`

**What:** `resolveRateFrom` accepts exactly two codes and throws a 422 keyed `payment.currency` for
anything else (`sale.service.ts:52-61`). The obvious client-side shape is
`currency === main ? 1 : exchangeRate`, which silently prices a shilling tender as if it were
dollars for any third code — and the currency config reads `""` for both codes while it is loading,
so "any third code" includes the first paint.

**So what:** `resolveRate` answers `number | null`, and `counter.tsx` carries a `null` into
`clientIssues` as a *blank* currency, which is refused with the same message. The counter also holds
its whole render behind `config.isLoading` — the screen cannot price anything without the business's
currencies, and a price that gains its code a beat after it lands reads as a bug.

---

## `change` is in the tendered currency, `amountDue` is in main — and the canvas draws both bare

**What:** artboard `2a` puts `100.00` in the amount-tendered box and `167.75` in the amount-due box,
neither carrying a code. That is honest only in the canvas's own example, where the shop tenders in
its own main currency. A USD 100 note against a KES 13,000 bill draws `100.00` beside `6,500.00`,
which are not the same money and read as if they were.

**Evidence:** `docs/design/TradeOs-UI.dc.html:329` and `:332`; the currencies are §6/trap 5 of the
contract, and `payment.change` is in `payment.currency` while `payment.amountDue` is in main.

**So what:** the second box always renders through `formatMoney`, code included, and switches its
label to **Change** with the tendered currency when the bill is overpaid. That is a deliberate
departure from the canvas, and the one place on this screen where correctness beat fidelity.

---

## The credit block reopens when the **server** asks for it, and a test caught the gap

**What:** the block is shown when a tender leaves a balance. That is a client-side judgement, and the
client and the server can genuinely disagree about `amountDue`: `unitPrice` is **omitted** for a line
still priced at the product's selling price, and the server substitutes `product.sellingPrice` at
**commit time** (`sale.service.ts:153`, and the "omitting `unitPrice` defers the price to commit
time" note above). A price edited in another tab between the scan and the tap makes the server's
total — and its `amountDue` — larger than the one on screen.

The first version routed the resulting 422 (`errors.customerId` / `errors.dueDate`) to two controls
that were not rendered, so the sale refused itself in silence. `counter.test.tsx` found it.

**So what:** `showCredit` is `(a tender left a balance) || issues.customer || issues.dueDate`. The
general rule this is an instance of: **any control that is conditionally rendered on a client-side
prediction must also render when the server's answer names it**, or the error handling has a hole
exactly where the prediction was wrong.

---

## One field serves the scanner, because `GET /products?search=` matches a barcode exactly

**What:** the counter has one 52px box for both a scan and a search, and no second query. The list
endpoint's `search` is a **prefix** match on the name **OR an exact barcode match** — the backend
says so in its own comment.

**Evidence:** `../Backend/src/db/actions/product.actions.ts:59-63`:

```ts
// ...the scan lookup and the free-text search share one query parameter.
const pattern = new RegExp(`^${escapeRegex(search)}`, "i");
filter.$or = [{ searchName: pattern }, { barcode: search }];
```

**So what:** `useProductByBarcode` (`features/products/hooks/use-product.ts`) exists, is documented as
"Slice 3's counter is the real caller", and is **deliberately not used**. Using it would mean deciding
on every keystroke whether a half-typed value is a barcode or a name, and
`GET /products/barcode/:code` validates the code as 4–64 characters of `[A-Za-z0-9._-]` — so a
three-character search is a 422 rather than a miss. It remains the right hook for a dedicated scan
field with no free-text half; it is the wrong one for a box that is both.

---

## The scan's auto-add is the one effect on the screen, and `isPlaceholderData` is what makes it correct

**What:** a scanner types a burst and presses Enter. Enter commits the term past the 300ms debounce
(300ms of nothing after a beep reads as a dropped scan), but the answer still arrives a request
later, and adding a line is a side effect that cannot happen during render. So Enter records which
term is in flight and an effect rings the product up when the results for *that* term land.

**Evidence:** `useProducts` sets `placeholderData: keepPreviousData`, so between the key changing and
the answer arriving `data` is **the previous search's rows**. Without `!isPlaceholderData` in the
guard, a scan is matched against whatever the grid was showing beforehand — which for a counter's
opening state is the first twelve products in the catalogue, and rings up the wrong one whenever
that list happens to hold exactly one row.

**So what:** the guard is `scanning === search && !isPending && !isPlaceholderData`, and `scanning`
is cleared before anything else so one scan can only fire once. Two or more matches is a name prefix
rather than a barcode and is left on screen to be tapped — guessing which was meant is how the wrong
thing reaches a receipt.

---

## `MoneyInput`'s `max` and `fillLabel` are unusable at a counter, and they come as a pair

**What:** the shared field's "Pay in full" affordance is `fillLabel`, which renders **only when `max`
is also given** (`components/shared/money-input.tsx`: `fillLabel !== undefined && max !== undefined`).
And `max` brings the over-max state with it — the field flags the amount and changes its hint to
"over the max of …".

At a till, handing over more than the bill is the normal case and the answer is change, not a
refusal. So passing `max={total}` to get a one-tap "exact amount" button would mark a legitimate USD
300 against a USD 267.75 bill as an error.

**So what:** the counter passes neither, and therefore **has no "pay in full" button** — the cashier
types the amount. That is a real ergonomic cost on the commonest transaction in the product, and the
fix belongs in `MoneyInput`: decouple `fillLabel` from `max` by giving it its own `fillValue`, or add
an `allowOverMax` flag. Both are small; neither is in this task's files.

---

## Overriding `MoneyInput`'s fill takes an arbitrary variant, because `className` lands on the wrapper

**What:** `docs/findings/slice3-money-ui.md` says a caller placing the field on `--background` should
"pass a `className` overriding the fill rather than changing the default". The payment band **is**
`--background` (canvas `:317`) and the field is drawn a step lighter on it (`:329`). But
`MoneyInput`'s `className` is spread onto its outer `<div>`, not its `<input>`, and the input's
`bg-background` is hardcoded.

**So what:** the counter passes `className="[&_input]:bg-card"`. It works and it is the documented
intent, but the spelling is not obvious from the prop's name — worth an `inputClassName` prop the
next time that component is opened.

---

## `round3` is transcribed a third time, and the cart store's stated reason for it is wrong

**What:** the quantity stepper needs `round3` and `features/sales/store/cart.ts` keeps its copy
module-private, so `cart-line.tsx` carries a third transcription of `../Backend/src/lib/money.ts:21`.

While pinning it, the store's own justification turned out not to hold. Its comment says the merged
quantity is rounded because `0.1 + 0.2` is `0.30000000000000004`, "which `isQuantity` rejects
(`money.ts:42-47`)". It does not: the decimal test is `|n * 1000 - round(n * 1000)| < 1e-6`, and
that difference is `6e-14`. Verified numerically:

```
isQuantity(0.30000000000000004) -> true
isQuantity(1.1179999999999999)  -> true      // 0.118 + 1, one tap of the stepper
```

**So what:** `round3` is still right, for two reasons that are not the one written down. The box
renders `String(value)` for a quantity (a settled `1.000` would be noise on a line sold by weight),
so without it a single `+` on a 0.118 kg line shows **sixteen digits** in a 52px cell. And the value
goes on the wire and is stored, so the sale would carry precision nobody entered. The comment in
`cart.ts` should be corrected to say so — the rule is still "round it", the reason is display and
storage rather than a refusal. `cart-line.test.tsx` pins the 0.118 case.

---

## An empty amount box is not zero, and a fully-paid sale must not carry a due date

Two payload rules the counter enforces that no schema can:

- **The empty tender is refused, not defaulted.** `amountTendered` has no server-side default and an
  omitted one is a 422 that does *not* mean "paid in full" (contract trap 7). An empty box is
  equally not `0`: a cashier who has typed nothing has not yet declared a sale entirely on credit.
  The message says so — "Type 0 for a sale entirely on credit" — because that is otherwise an
  unguessable way to record the one thing the block exists for.
- **`dueDate` is dropped when `amountDue === 0`.** The server only reads it when a debt is opened,
  and the block's state survives a cashier typing a larger tender — so a date chosen a moment
  earlier would ride along on a paid sale, meaning nothing and looking deliberate on the stored
  document.

---

## The sale discount is editable, and artboard `2a` draws no control for it

**What:** the canvas prints `Sale discount   USD 5.00` as static text between the subtotal and the
total, and there is no control anywhere on the screen that could have produced that number. Yet
`POST /sales` takes an order-level `discount` and the counter is the only place a shopkeeper could
set one.

**So what:** the figure itself is the control — a right-aligned numeric cell that looks like the text
it replaces and grows a border on hover and focus. A labelled field would have pushed the 28px total
off the fold on a 480px column. The API's own refusal (`errors.discount`, "Discount exceeds the
subtotal") lands on it, and so does `cartIssues`' client-side version of the same rule.

---

## Smaller notes

- **The stepper's floor is 1, not 0.** `quantitySchema` is strictly positive, so a `−` that reached
  zero would produce a line the endpoint refuses. The floor is a removal, and the bin is the control
  for it.
- **Out of stock is `trackStock && quantity <= 0`**, exported from `product-tile.tsx` so the tile and
  the scanner agree. Reading `quantity <= 0` alone greys out every service and fee in the catalogue,
  whose quantity is a frozen `0` the API refuses to move.
- **`StockBadge` is reused instead of redrawing the canvas's pill.** `2a` puts the pill beside the
  price and the quantity on its own line; the shared badge keeps them together. Two copies of "low"
  and "out" would be a tile disagreeing with the product table about the same shelf.
- **No `next/image` on a tile**, for the reason `product-table.tsx` gives: `images.remotePatterns` is
  empty without `NEXT_PUBLIC_S3_HOSTNAME`, and `next/image` throws on an unconfigured host.
- **The canvas's hatched placeholder is two CSS variables**
  (`repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--muted) 6px 12px)`), so it follows
  the theme without a second dark-mode rule. Its mono `{{ p.shot }}` chip has no field on `Product`
  and is dropped.
- **Category chips carry no colour from the API.** `2a` gives each chip its own `bg`/`fg`/`bd` from
  editor data; `Category` has `id`, `name`, `description`, `isDefault` and `key` and nothing visual.
  Selected/unselected is the repo's `--primary-soft` pill instead.
- **The counter does not navigate on success.** The next customer is already waiting, so the cart
  empties in place and the receipt is one tap away — off the cache `useCreateSale` seeds with the 201
  body, so `/sales/<id>` renders without fetching. The link is gated on `sales:view`, which
  `/sales/<id>` inherits from the `/sales` row by longest-prefix matching.
- **The clock in the header is mounted-only.** A time rendered once at mount is wrong within the
  minute and one rendered during SSR is a hydration mismatch, so it draws nothing until the client
  has it and then ticks every 30 seconds in a component of its own.
- **`NumericCell` is a third instance of the same lesson**: `type="number"` reports `""` for
  `"12."`, so the value vanishes for one keystroke. `MoneyInput` and `stock-dialog.tsx` each reached
  it independently; treat `type="number"` as unusable in this product.
