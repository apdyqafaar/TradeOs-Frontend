# Slice 3 — the debts and payments data layer

`features/debts/` — types, keys, schemas, service, four query/mutation hook files. No components.
Written against `docs/contracts/debts.md`, with every claim in that contract spot-checked against
`../Backend/src` before it was encoded.

## `docs/contracts/debts.md` is correct — every behavioural claim in it verified

**What:** Nothing in the contract had to be worked around. I re-read the seven route definitions,
both validators, both controllers' shapers, both services, `debt.actions.ts`, `payment.actions.ts`,
`debt.model.ts`, `payment.model.ts`, `common.validation.ts`, `util/errors.ts` and
`middleware/error.middleware.ts`, and every field, default, status transition, tolerance and error
code was as documented — including the four that are easiest to get wrong: `id` not `_id`, no
populated relations anywhere, `remaining` stored rather than derived, and `toMain` multiplying.

**Evidence:** the file:line citations in the contract resolve. A few drift by a line or two after
edits (the write-off `$set` the contract cites as `debt.actions.ts:128-140` is the `$set` object at
`130-137` inside a `findOneAndUpdate` spanning `126-141`; `findDebtsByOrganization` /
`countDebtsByOrganization` cited as `172-194` are `172-188` and `190-194`). No claim changed
meaning.

**So what:** treat that contract as trustworthy for this scope. The two entries below are things it
does not say, not things it says wrongly.

---

## The 422 `PAYMENT_EXCEEDS_BALANCE` also carries a **field error**, not only `details.remaining`

**What:** The contract describes the 422/409 split by `details` alone — "422 (with
`details.remaining`) or 409 (without)". The 422 additionally carries `errors: { amount: "Payment
exceeds the remaining balance" }`, which arrives on `ApiError.fieldErrors` and is therefore already
routed onto the amount input by `fieldErrorsFor` with no extra work. The 409 carries neither
`details` nor `errors`.

**Evidence:** `../Backend/src/services/payment.service.ts:46-51` constructs
`new ValidationError({ amount: "…" }, "…", { remaining: debt.remaining }, "PAYMENT_EXCEEDS_BALANCE")`
— the first argument is the field map. `ValidationError` stores it as `this.errors`
(`util/errors.ts:100-119`), `middleware/error.middleware.ts:80-89` is the one branch that forwards
`error.errors` **and** `error.details` onto the envelope, and `lib/api/client.ts:152-153` maps
`envelope.errors → fieldErrors` and `envelope.details → details`. The 409 is a bare
`ConflictError("Payment no longer fits the balance", "PAYMENT_EXCEEDS_BALANCE")`
(`payment.service.ts:59-68`) — a `ConflictError` with no `details` argument, and `ConflictError` has
no `errors` field at all.

**So what:** the two shapes need different UI, not one handler.

- **422** — the form's normal 422 path already puts a message on the `amount` box.
  `remainingFromPaymentError(error)` (in `schemas/debt.schema.ts`) returns the server's balance so
  the message can name it.
- **409** — the balance moved *while the request was in flight*; the server does not claim to know
  the new value and deliberately sends nothing. `remainingFromPaymentError` returns `undefined`
  here, and the honest copy is "someone else recorded a payment on this debt just now" followed by a
  refetch. Printing the balance the screen was already holding would be presenting a number the
  server has just told you is stale.

`PAYMENT_CONFLICT_FIELDS` maps the code to `amount` so the 409 can still be shown at the box the
user must change, since it arrives with no field map of its own.

---

## `TZDate.prototype.toISOString()` emits an **offset**, and `POST /debts` rejects offsets

**What:** Three separate things break a `dueDate`, and two of them are invisible in East Africa,
which is where this will be tested first.

1. `z.string().datetime()` rejects a bare `"2026-09-30"`. The contract says this.
2. It **also rejects an offset form** — `"2026-09-30T12:00:00.000+03:00"` fails. The contract says
   "full ISO-8601 datetime, not a bare `YYYY-MM-DD`", which reads as though any full datetime is
   fine. Only the `Z` form is.
3. `new TZDate(…).toISOString()` — the natural way to build "noon in the business timezone" with the
   library this repo already uses — produces exactly that rejected offset form.

**Evidence:** run against this repo's zod 4.5.4 (backend is 4.4.3, same defaults):

```
z.iso.datetime().safeParse("2026-09-30T00:00:00+03:00")  → false
z.iso.datetime({ offset: true }).safeParse(same)         → true
new TZDate(2026, 8, 30, 12, 0, 0, 0, "Africa/Nairobi").toISOString()
                                       → "2026-09-30T12:00:00.000+03:00"
new Date(thatTZDate.getTime()).toISOString()
                                       → "2026-09-30T09:00:00.000Z"     ✅ accepted
```

And the obvious `new Date("2026-09-30").toISOString()` gives midnight **UTC**, which the server
compares against `startOfDayIn(organization.timezone, now)` (`debt.service.ts:55-59`,
`lib/period.ts:46-47`). For any business west of Greenwich that instant is *before* the start of the
picked day, so a shop in New York picking today is told the due date is in the past — a 422 on a
field the user filled in correctly.

**So what:** `dueDateFromCalendarDate(calendarDate, timeZone)` in
`features/debts/schemas/debt.schema.ts` is the only supported way to build this field. It takes the
`YYYY-MM-DD` a native date input produces plus `useOrganization().timezone`, builds **noon in that
zone** (unambiguous across DST — a midnight can simply not exist on a spring-forward date; on the
calendar day the person picked; comfortably after that day's start in every zone), and round-trips
through a plain `Date` so it serialises with a `Z`. Both rejections and both timezone cases are
pinned in `debt.schema.test.ts`. The form must not call `toISOString()` on a `TZDate` directly.

---

## Two different failures on one payment request both answer `NOT_FOUND`, and the currency check runs first

**What:** `recordPayment` resolves the exchange rate **before** it loads the debt. So on
`POST /debts/:id/payments`:

- a currency that is neither the org's main nor its exchange currency is a 422 on `currency` even
  when the debt id is nonsense — the 422 says nothing about whether the debt exists;
- a **404 `NOT_FOUND`** means either "no such debt in this organization" *or* "this organization has
  no `CurrencyConfig`", with the same code and only the message ("Debt not found" vs "Currency
  configuration not found") telling them apart — and this repo's rule is to branch on `code`, never
  on `message`.

**Evidence:** `payment.service.ts:34-38` — `resolveRate(...)` then `toMain(...)` then
`findDebtById(...)`. `debt.service.ts:29-30` — `if (!config) throw new NotFoundError("Currency
configuration")`.

**So what:** a 404 from the record-payment call is not proof the debt is gone; do not remove the debt
from the cache or navigate away on it. In practice a business that reached this screen has a
currency config, so the useful handling is a generic "could not record that payment" plus a refetch
of the debt — which resolves the ambiguity by showing whether the debt is still there.

---

## `GET /debts` cannot render the debts screen the Overview shows

**What:** The Overview's Debts panel (design canvas artboard `1c`, `docs/design/TradeOs-UI.dc.html`
lines ~2197-2233) draws customer **name and phone** next to `remaining`, a days-overdue badge and a
due date. That panel is served by `GET /dashboard`, which pre-joins the customer
(`DashboardOverdueDebt.customer` in `features/dashboard/types.ts:107-116`). `GET /debts` cannot
produce it:

- **nothing is populated** — `customerId` is a bare id string, and there is no `populate(` call
  anywhere in the debts/payments backend path;
- there is **no search parameter** and **no date-window filter** — `listDebtsQuerySchema` is
  `page`, `limit`, `status`, `customerId`, `.strict()`. The dashboard's `dueWithin7Days` figure has
  no equivalent on the list;
- there is **no sort parameter**: the sort is chosen *by the status filter*. `open` and `overdue`
  sort `{ dueDate: 1, _id: 1 }`, every other value sorts `{ createdAt: -1, _id: -1 }`
  (`debt.actions.ts:178-183`).

**So what:** three consequences for whoever builds the screen.

1. A debts table with customer names needs a join the API will not do — either one
   `useCustomers({ limit: 100 })` fetch keyed by id for the page, or `useCustomer(id)` per row.
   Prefer the first; do not assume a `debt.customer` will appear.
2. A free-text "find a debt" box cannot exist. Resolve a customer through `features/customers` and
   pass `customerId`.
3. A fixed "Due date ↓" sort indicator on the table header would be **wrong on four of the six
   status filters**. Either render the sort as a consequence of the filter, or do not render a sort
   affordance at all. `DebtListParams.status` carries this note.

---

## The status / overdue model, as implemented

**What:** `"overdue"` exists in exactly two places, and neither is a value a debt can hold.

| Concept | Where it lives here | Notes |
|---|---|---|
| Stored status | `DebtStatus = "open" \| "paid" \| "written_off" \| "cancelled"` | The model enum, and the whole of it (`debt.model.ts:57-62`). |
| Filter value | `DEBT_STATUS_FILTERS` / `DebtStatusFilter` — the six members `?status=` takes, `"overdue"` and `"all"` among them | `"overdue"` is rewritten server-side to `status:"open" AND dueDate<now AND remaining>0` (`debt.actions.ts:162-165`); `"all"` drops the clause. |
| Per-row truth | `Debt.isOverdue` / `Debt.daysOverdue`, computed fresh on every response | `debt.actions.ts:146-149`, `debt.controller.ts:17-18`. |

`DebtStatus` and `DebtStatusFilter` are **separate types on purpose**, so `debt.status === "overdue"`
does not compile — the mistake the contract warns about becomes a type error rather than a badge
that never appears. `DEBT_STATUS_FILTERS` is a runtime array with `DebtStatusFilter` derived from it,
so a filter control renders from the same source the type comes from and cannot offer a seventh
value the `.strict()` query schema would 422 on.

Nothing client-side recomputes `isOverdue`, `daysOverdue`, `remaining`, or "is this basically paid
off". The settlement tolerance (`remaining <= 0.004` → `status: "paid"`, `remaining` forced to
exactly `0`) and the payment overshoot tolerance (`<= 0.01` is silently **clamped** to the balance,
not refused) are server-internal and never on the wire, so any client arithmetic can disagree with
the server by a cent. `MainCurrencyAmount` names every amount that has no currency field beside it —
a `Debt` carries none at all, so the code comes from `useOrganization().currency`.

---

## Cache invalidation: five keys, and one of them belongs to another feature

**What:** Every write in this slice moves a balance that is rendered in places that do not know
about each other. `hooks/use-debt-mutations.ts` states the fan-out per mutation; the summary:

| Mutation | Seeds | Invalidates |
|---|---|---|
| `useCreateDebt` | `debtKeys.detail(id)` | `debtKeys.lists()`, `customerKeys.detail(customerId)`, `dashboardKeys.all` |
| `useRecordPayment` | — | `debtKeys.detail`, `debtKeys.lists()`, `debtKeys.payments(debtId)`, `customerKeys.detail`, `dashboardKeys.all` |
| `useWriteOffDebt` | `debtKeys.detail(id)` | `debtKeys.lists()`, `customerKeys.detail(customerId)`, `dashboardKeys.all` |
| `useVoidPayment` | — | `debtKeys.detail`, `debtKeys.lists()`, `debtKeys.payments(debtId)`, `customerKeys.detail`, `dashboardKeys.all` |

**So what:** four decisions worth knowing.

- **`customerKeys.detail` is the cross-feature edge.** `features/customers` renders
  `{ open, overdue, totalRemaining }` from a server aggregate over open debts
  (`debt.actions.ts:197-221`); nothing in that feature can know a payment happened, so the write has
  to say so. It also matters for write-off specifically: `DELETE /customers/:id` refuses with 409
  `CUSTOMER_HAS_OPEN_DEBT` while any open debt exists, and a write-off is what clears that — a stale
  summary is an Archive button that stays disabled for no visible reason.
- **`customerKeys.lists()` is deliberately not invalidated.** `publicCustomer` is nine fields with no
  debt figures among them, so a customer list row cannot go stale from a debt moving.
- **Create and write-off seed the detail entry; payment and void cannot.** `POST /debts` and
  `POST /debts/:id/write-off` both return a `publicDebt` — the same shaper `GET /debts/:id` uses — so
  writing it into `debtKeys.detail` invents nothing. `POST /debts/:id/payments` and
  `POST /payments/:id/void` return a **`Payment`**; the debt's new `paid`/`remaining`/`status` are
  simply not in the response, and the only honest way to learn them is to ask. (This is the mirror of
  `useCreateCustomer`, which does *not* seed, because a customer detail key holds a richer shape than
  a create returns. Same reasoning, opposite answer.)
- **A write-off does not touch `debtKeys.payments`.** It creates no payment and voids none.

`debtKeys.payments(debtId)` sits at `["debts", "payments", debtId]` rather than under
`detail(debtId)`, following `productKeys.movements`: the two are invalidated for different reasons,
and nesting would make every debt refetch drag a page of payments with it.

---

## `DEBT_NOT_OPEN` is one code for two situations, and the split is structural

**What:** 409 `DEBT_NOT_OPEN` with the identical message `"Debt is not open"` is raised by both
`payment.service.ts:39` (paying a debt that is not `open`) and `debt.service.ts:98` (writing off a
debt that is not `open` **with `remaining > 0`** — which includes a fully paid debt, where there is
nothing left to write off).

**So what:** there is nothing on the error to tell them apart, so the endpoint that raised it has to.
`useRecordPayment` and `useWriteOffDebt` are separate hooks — not one `useDebtAction` — and each
carries the specific reading in its doc comment: "this debt is no longer open, refresh to see where
it stands" for the payment path, "there is nothing left to write off on this debt" for the write-off.
A shared hook would have destroyed the only distinguishing information at the point where the message
gets written.

---

## Smaller things, recorded so nobody re-derives them

- **`GET /debts/:id/payments` has no status filter and the schema is `.strict()`**, so `?status=` is a
  422, not a narrower list. Voided payments are always mixed in. A "hide voided" control filters the
  fetched page only — `meta.total` keeps counting the voided rows, so it must not present itself as
  filtering the history.
- **A payment's `amountMain`, not `amount`, is what moved the balance** (`payment.service.ts:58`).
  Any reconciliation against `Debt.paid` sums `amountMain` and excludes `status: "voided"`.
- **`POST /debts/:id/payments` can succeed with an amount smaller than the one sent** — an overshoot
  of a cent or less is clamped to the balance (`payment.service.ts:41-53`). Render the response, not
  the request.
- **A void that hits `DEBT_WRITTEN_OFF` leaves the payment `"completed"`.** The check runs after the
  void has been applied inside the transaction, so the rollback undoes it; nothing partial is
  committed and a retry fails identically. Do not offer a retry.
- **`writtenOffAmount` is the balance at the instant of write-off, not `principal`** — a debt paid 4
  of 10 comes back `paid: 4, writtenOffAmount: 6`. The amount a confirm dialog shows before the call
  is `debt.remaining` as of its last fetch, i.e. a guess; the response is the fact.
- **`createdBy` is on the Debt model but not on the wire** (`publicDebt` drops it). There is no way to
  show who raised a debt.
- **`note` on a payment collapses blank → absent** in `recordPaymentSchema`. The API would accept
  `""`, but an empty note is noise on a record read back in disputes, and `JSON.stringify` drops the
  key so the request omits it — which is what "no note" means to the API.
- **The payment body has no `exchangeRate` field and the body is `.strict()`**, so sending one is a
  422. The server resolves the rate live and freezes it (`debt.service.ts:25-38`). A conversion
  preview reads `useCurrencyConfig()` for display only; the number on the record is the server's.
  The currency itself must be offered as a choice of the org's main or exchange code — a free-text
  3-letter box passes this schema and then 422s one layer down.

---

## Verification

- `bunx tsc --noEmit` — clean.
- `bunx vitest run features/debts` — 23 tests, 1 file, green.
- `bunx biome check features/debts` — clean (9 files).
- `bunx biome check .` reports 16 errors, **none of them in `features/debts`**: all are in
  `features/sales/*`, `components/shared/{money-input,currency-toggle}*` and
  `features/customers/components/{customer-picker,customers-page}*`, which were in flight from other
  agents while this ran. Left untouched.

---

# Building the debt detail screen (`/debts/[id]`, artboard `2g`) — 2026-09-09

Appended by the task that built `features/debts/components/*` and
`app/(app)/debts/[id]/page.tsx`. Everything above held; nothing here contradicts it. These are the
things the components had to decide that the contract, the canvas and the data layer between them
did not answer.

## The two `PAYMENT_EXCEEDS_BALANCE` shapes, written out as sentences

The split is already recorded above; this is what it reads as on screen, so the next person does
not have to re-derive the wording.

| | 422 (pre-check) | 409 (lost the race) |
|---|---|---|
| carries | `errors: { amount }` **and** `details.remaining` | neither |
| lands on | the amount box, unaided | the amount box, via `PAYMENT_CONFLICT_FIELDS` |
| copy | *"That is more than the USD 120.50 still owed on this debt."* | *"Someone else recorded a payment against this debt while this one was going through, so this amount no longer fits. Nothing was taken from this one — the balance above is refreshing."* |
| quotes a balance | yes — **the server's**, from `details.remaining`, never the one on screen | **no** |

The 422's message deliberately *replaces* the API's own field message rather than deferring to it.
The API says "Payment exceeds the remaining balance", which is true and useless: the reader needs
the number they have to type under, and only `details.remaining` has it — the figure the screen was
holding may already be out of date, which is why the server sends its own.

The 409 says nothing about an amount at all. It is the only refusal on this screen that means "the
number you are looking at is wrong", so it is also the only one whose copy points at the balance
above rather than at the box. Both variants call `onStale`, which refetches the debt.

**The assertion worth keeping:** `record-payment-dialog.test.tsx` asserts the 409 alert does *not*
contain `167.75`, the balance the fixture debt holds. Printing a stale figure there is the exact
failure the 409's empty body exists to prevent.

## "Pay in full" cannot exist in the exchange currency, and the canvas draws it anyway

**What:** artboard `2g` puts "Pay in full" beside the Amount label unconditionally, above a toggle
offering both codes. In the exchange currency the affordance cannot be honest.

**Evidence:** the balance is stored in the main currency and `amountMain = round2(amount * rate)`.
With main KES, exchange USD, rate 130 and a balance of KES 1,000, the exact settlement is
USD 7.6923…. `7.69` converts to 999.70 and leaves 0.30 owing — the debt stays `open`, nowhere near
the settlement tolerance of 0.004. `7.70` converts to 1,001.00, an overshoot of 1.00, far past the
0.01 clamp, so it is a 422 `PAYMENT_EXCEEDS_BALANCE`. Neither value settles the debt, and there is
no third.

**So what:** `RecordPaymentDialog` passes `fillLabel` only when the selected code is the main
currency; in the exchange currency the `max` hint stands alone. This is the one place the screen
knowingly departs from the canvas. The alternative is a button labelled "Pay in full" that leaves a
residue or 422s.

## The exchange-currency `max` hint must **floor**, never round

Same arithmetic, different consequence. `maxIn(remaining, rate)` is
`Math.floor((remaining / rate) * 100) / 100` — rounding to nearest can land a cent *above* the
balance, and `amount * rate` then overshoots by up to `0.005 * rate`, which at any rate above 2 is
past the server's 0.01 tolerance. A max hint that 422s is worse than no hint, because the screen
suggested the number.

This is also the one **division** in the slice (`fromMain`, `money.ts:31`), and it is correct here:
main → exchange divides, exchange → main multiplies. The dialog's `toMain` helper multiplies and
carries the warning; `maxIn` divides and carries this one. They are deliberately two functions.

## An amount over `max` is **not** blocked client-side

`MoneyInput` flags it (`over the max of USD 167.75`, plus `aria-invalid`) but the dialog still
sends it. The server clamps an overshoot of a cent or less to the balance rather than refusing it
(`payment.service.ts:41-53`), and that tolerance is not on the wire — a local refusal would invent
one the API would not make, on the very screen that must not disagree with the server about money.
The 422 comes back naming the server's own balance, which is a better answer than anything the
browser could compute.

## `receivedBy` has no name, and the frozen `exchangeRate` has nowhere to go

Two things artboard `2g` draws that the payload cannot fill:

1. **`{{ p.who }}`** — `receivedBy` is a bare Member id and there is no members slice. The row
   renders an em dash with `title="Received by member <id>"`, following
   `features/products/components/stock-movements-table.tsx`'s "Who" column rather than inventing a
   second answer to the same question.
2. **The rate.** A payment tendered in the exchange currency carries `exchangeRate` frozen at write
   time, and it is genuinely interesting on a disputed record — but the canvas's second line has
   room only for `tendered KES 5,000.00`. `formatExchange(...).converted` would print
   `≈ USD 38.46 @ 130`, a **second** main-currency figure beside `amountMain`, which is the one that
   actually moved the balance; two main-currency numbers on one row invite the reader to reconcile
   them. So the row shows the tendered amount alone. Surfacing the rate properly wants `RATE`
   exported from `lib/format/money.ts` — the export `currency-toggle.tsx` already duplicates four
   lines of, per `slice3-money-ui.md`. **This is the second caller; a third should do the export.**

## The screen has no way back to a list, on purpose

`ROUTES.debts` is `/debts` and `config/routes.ts` already gates it on `debts:view`, but
`app/(app)/debts/page.tsx` does not exist — the list is blocked on an open product decision. A
"Back to debts" link would be a 404 dressed as navigation, so there is none; there is a
`TODO(slice: 3)` where it belongs. The customer's name in the header is a real `Link` to
`/customers/[id]`, which exists and is where the rest of what that person owes lives.

The same reasoning applies to `saleId`: `/sales/[id]` does not exist either, so a sale-born debt
renders `Sale …abc123` as plain text with the full id in `title`, exactly as
`stock-movements-table.tsx` does. The id is shortened because a debt carries the sale's ObjectId,
not its receipt number — nothing in this payload knows what the counter printed.

## `useCustomer(undefined)` is how a permission gate goes in front of a query here

`debts:view` does not imply `customers:view`; they are separate rows in the catalog and a custom
role can hold one without the other. `DebtDetail` passes
`canViewCustomers ? debt?.customerId : undefined`, which `useCustomer`'s `enabled: Boolean(id)`
turns into "no request" rather than a guaranteed 403.

This is the cheap version of the split `customer-picker.tsx` needed. That component had to become
two components because `useCustomers` takes only `CustomerListParams` and has no `enabled` escape
hatch, so an early `return` before it would change the hook count as the session resolved.
`useCustomer`'s optional id **is** that escape hatch. **Prefer this shape when the hook already has
one; only split the component when it does not.**

Without a name, nothing is invented: the heading becomes the word "Debt" and the customer id is
printed in mono. A fabricated placeholder would be worse than an id somebody can paste into a
support ticket.

## `onStale` refetches the debt and not the payments

The dialogs call `onStale` on every refusal that means the debt moved underneath them — the 409
race, `DEBT_NOT_OPEN`, and a 404. `DebtDetail` wires it to `useDebt(...).refetch()` only.

The payments list is deliberately not refetched with it. The balance is what the refusals are
about; the competing payment that won a race is not this screen's own write, and reaching it would
mean either `useQueryClient` in a component (invalidation belongs in the hooks layer) or a second
`useDebtPayments` call whose params — and therefore whose query key — differ from the timeline's,
because the timeline's page number lives in `?payPage`. The timeline refreshes itself whenever one
of its own mutations lands, which covers every case the user caused.

## Design decisions the tokens did not settle

- **The write-off confirm is a solid red.** The canvas draws `#C0392B` with off-white text, which is
  `--destructive` / `--destructive-foreground`. The vendored `destructive` button variant is a
  *soft* tint (`bg-destructive/10`) — right for a reversible destructive action and wrong here,
  since there is no un-write-off endpoint. The variant is overridden with the tokens, not the hex.
- **The progress bar gained a second segment.** The canvas draws one green bar because it draws a
  debt with nothing written off. A written-off debt would otherwise show a bar that stops at 25%
  with no hint that the other 75% is never coming, so `writtenOffAmount / principal` gets its own
  `--muted-3` segment and the caption reads `40% paid · 60% written off`. Both segments are shares
  of `principal`, which is why they can never sum past the track: the backend asserts
  `principal === paid + remaining + writtenOffAmount` after every mutation.
- **The progress bar is `aria-hidden`.** `role="progressbar"` would need an `aria-valuenow`, and
  biome's `useSemanticElements` asks for a `<progress>` element for that role anyway. The caption
  beside it already carries the same fact as text, so announcing the bar would say it twice.
- **The status pill has four members and no fifth.** `STATUS_STYLES` is
  `Record<DebtStatus, string>`, so adding `overdue` is a compile error rather than a badge that
  never appears. Overdue is a separate `--destructive-soft` badge rendered from `debt.isOverdue`
  and `debt.daysOverdue`.
- **Both actions are hidden by *state* as well as by permission.** `payments:create` and
  `debts:write_off` gate them, and so does `status === "open"` — plus `remaining > 0` for the
  write-off, matching `writeOffDebtById`'s guard. A button whose every press is a guaranteed 409 is
  worse than no button: the repo's hide-don't-disable rule applied to a second axis.
- **Voiding is an inline confirm inside the timeline row, not a third dialog.** `voidSchema` is one
  required field, the row is the context, and the refusal has to land beside the control that was
  refused. The control is hidden entirely on a written-off debt, where 409 `DEBT_WRITTEN_OFF` is
  certain, with one muted line saying why.

## A React Query detail that made a test lie

A query disabled by an `undefined` id reports `isPending: true` **for ever** in v5 (status
`"pending"`, fetchStatus `"idle"`) and never carries data. A `useCustomer` mock that ignored its
argument and always returned data made `DebtDetail` look as though it had resolved a customer it
never asked for: the "does not fetch a customer it has no permission to read" test passed its
`toHaveBeenCalledWith(undefined)` assertion and then found the name on screen anyway. The mock is
now argument-aware and returns `{ isPending: true, data: undefined }` for a disabled call, which is
also what exercises the `canViewCustomers && customer.isPending` guard on the header skeleton.

## Verification

- `bunx tsc --noEmit` — clean.
- `bunx vitest run features/debts` — 58 tests, 6 files, green.
- `bunx vitest run` (full suite, once) — 373 tests, 49 files, green.
- `bunx biome check .` — 3 errors, **none in `features/debts` or `app/(app)/debts`**: two formatter
  diffs and one `useSemanticElements` in `features/sales/components/counter/*`, which was in flight
  from another agent while this ran. The tree was clean when this task started. Left untouched.
