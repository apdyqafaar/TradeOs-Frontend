# Debts & Payments API contract

Extracted read-only from `C:\Users\Aa\Desktop\TradeOs\Backend` on 2026-09-09. Every claim is
cited `file:line` against that repo. Where something could not be confirmed from source, it is
marked **unverified** with the reason — do not guess past those markers.

Base path: `/api/v1` (Backend `src/app.ts:54`) then `/debts` or `/payments`
(`src/routes/v1/index.ts:41-42`).

Route wiring note: every route in `debt.route.ts` and `payment.route.ts` lists middleware in the
literal order **`validate` → `requireAuth` → `requireMember` → `requirePermission` → handler**
(`src/routes/v1/debt.route.ts:22-74`, `src/routes/v1/payment.route.ts:15-22`). Express runs
middleware in the order passed to the route, so a malformed body/query on an **unauthenticated**
request returns `422 VALIDATION_ERROR` before auth is ever checked, not `401`.

---

## 1. `GET /debts` (`debts:view`)

`src/routes/v1/debt.route.ts:22-29` → `debt.controller.ts:listDebts` (`:58-69`) →
`debt.service.ts:listDebts` (`:71-78`) → `db/actions/debt.actions.ts:findDebtsByOrganization` /
`countDebtsByOrganization` (`:172-194`).

### Query params — `listDebtsQuerySchema` (`src/validators/debt.validation.ts:15-21`)

Spreads `paginationQuerySchema.shape` (`src/validators/common.validation.ts:27-30`) plus:

| field | type | required | default | notes |
|---|---|---|---|---|
| `page` | `z.coerce.number().int().min(1)` | no | `1` | coerced from query string (`common.validation.ts:28`) |
| `limit` | `z.coerce.number().int().min(1).max(100)` | no | `20` | (`common.validation.ts:29`) |
| `status` | `z.enum(["open","overdue","paid","written_off","cancelled","all"])` | no | **`"open"`** | (`debt.validation.ts:18`) |
| `customerId` | `objectIdSchema.optional()` | no | — | 24-hex ObjectId string (`common.validation.ts:5-7`, `debt.validation.ts:19`) |

Schema is `.strict()` (`debt.validation.ts:21`) — unknown query keys are a `422 VALIDATION_ERROR`.
Body must be absent/empty: `noBodySchema` (`debt.route.ts:24`, `common.validation.ts:21`).

`status=overdue` is **not** a literal DB status match — the filter builder rewrites it to
`{status:"open", dueDate:{$lt:now}, remaining:{$gt:0}}` (`debt.actions.ts:159-170`).
`status=all` drops the status clause entirely, still honoring `customerId`
(`debt.actions.ts:166`).

Sort order: for `status` = `open` or `overdue`, `{dueDate:1, _id:1}` (soonest due first); for
every other status, `{createdAt:-1, _id:-1}` (newest first) (`debt.actions.ts:180-183`).

### Response envelope

`paginatedResponse` (`src/util/responses.ts:52-61`):

```json
{ "success": true, "message": "Debts fetched", "data": [ <publicDebt>, ... ],
  "meta": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 } }
```

`meta` keys are exactly `page`, `limit`, `total`, `totalPages` — `totalPages =
Math.ceil(total/limit)` (`responses.ts:60`). Controller call:
`debt.controller.ts:64-68`.

---

## 2. `POST /debts` (`debts:create`)

`debt.route.ts:31-38` → `createDebt` (`debt.controller.ts:52-56`) →
`debt.service.ts:createManualDebt` (`:41-69`) → `db/actions/debt.actions.ts:createDebt` (`:16-42`).

### Body — `createDebtSchema` (`debt.validation.ts:4-11`)

| field | type | required | notes |
|---|---|---|---|
| `customerId` | `objectIdSchema` | yes | 24-hex string (`common.validation.ts:5-7`) |
| `amount` | `moneySchema.refine(n=>n>0)` | yes | must be `>0` (`debt.validation.ts:7`); `moneySchema` = finite, `>=0`, ≤2 decimals, ≤`MAX_MONEY` (1e12) (`common.validation.ts:33-35`, `money.ts:12,34-39`) |
| `dueDate` | `z.string().datetime()` | yes | **full ISO-8601 datetime**, not a bare `YYYY-MM-DD` date (`debt.validation.ts:8`) |
| `description` | `z.string().trim().min(1).max(500)` | yes | (`debt.validation.ts:9`) — note: on the model, `description` is only conditionally required (`source==="manual"`, `debt.model.ts:47-51`), but the manual-create validator makes it unconditionally required at the HTTP layer |

`.strict()` (`debt.validation.ts:11`) — no `.default()`s in this schema.

Service-layer checks beyond zod (`debt.service.ts:41-69`):
- customer must exist → else `404 NOT_FOUND` (`:46-47`)
- customer must be `status:"active"` → else `409 CUSTOMER_ARCHIVED` (`:48-50`)
- `dueDate` must be **today or later**, compared against `startOfDayIn(organization.timezone,
  now)` → else `422 VALIDATION_ERROR` on field `dueDate` (`:55-59`)
- `principal` is stored as `round2(input.amount)` (`:65`, `money.ts:18`)

### Response — `201`, `publicDebt` (see §Response shape below). Message: `"Debt created"`
(`debt.controller.ts:55`).

---

## 3. `GET /debts/:id` (`debts:view`)

`debt.route.ts:40-47` → `getDebt` (`debt.controller.ts:71-77`) → `debt.service.ts:getDebtById`
(`:80-84`) → `db/actions/debt.actions.ts:findDebtById` (`:44-49`).

Params: `idParamSchema` = `{ id: objectIdSchema }` (`common.validation.ts:10`). Body must be
absent (`noBodySchema`). Tenant-scoped by `organizationId` in the query
(`debt.actions.ts:44-49`) — a debt belonging to another org is a `404`, confirmed by test
`tests/integration/debts/debts.test.ts:314-342`.

Response: `200`, `publicDebt`, message `"Debt fetched"` (`debt.controller.ts:76`).

---

## 4. `GET /debts/:id/payments` (`debts:view`)

`debt.route.ts:49-56` → `listPayments` (`debt.controller.ts:101-113`) →
`payment.service.ts:listPaymentsForDebt` (`:125-137`) →
`db/actions/payment.actions.ts:findPaymentsByDebt` / `countPaymentsByDebt` (`:69-80`).

### Query — `listPaymentsQuerySchema` (`payment.validation.ts:12`)

Only `page`/`limit` from `paginationQuerySchema.shape`, same defaults as §1
(`common.validation.ts:27-30`). **No status filter param exists for this list** — voided
payments are always included. Proven by test: a voided + a completed payment both come back,
2 items, `["completed","voided"]` after sorting (`tests/integration/debts/payments.test.ts:331-347`).
`.strict()` (`payment.validation.ts:12`) — an unknown query key (e.g. attempting `?status=`) is
a `422`.

404s if the debt itself doesn't exist / isn't in this org (`payment.service.ts:130-131`).

Sort: `{createdAt:-1, _id:-1}` — newest first (`payment.actions.ts:74-77`).

### Response envelope

Same `paginatedResponse` shape as §1: `{ success, message:"Payments fetched", data:
[<publicPayment>,...], meta:{page,limit,total,totalPages} }` (`debt.controller.ts:108-112`).

---

## 5. `POST /debts/:id/payments` (`payments:create`)

`debt.route.ts:58-65` → `createPayment` (`debt.controller.ts:88-99`) →
`payment.service.ts:recordPayment` (`:28-90`) → `debt.actions.ts:applyPaymentToDebt` /
`markDebtPaidIfSettled` (`:58-92`) + `payment.actions.ts:createPayment` (`:15-39`).

### Body — `createPaymentSchema` (`payment.validation.ts:4-10`)

| field | type | required | notes |
|---|---|---|---|
| `amount` | `moneySchema.refine(n=>n>0)` | yes | (`payment.validation.ts:6`) |
| `currency` | `z.string().trim().toUpperCase().length(3)` | yes | auto-uppercased by zod itself; length check runs **after** trim+uppercase (`payment.validation.ts:7`) |
| `note` | `z.string().trim().max(500)` | no (optional) | (`payment.validation.ts:8`) |

`.strict()` (`payment.validation.ts:10`). No `exchangeRate` field on the request — the server
resolves it. Passing 3 letters that pass zod (e.g. `"EUR"`) but aren't the org's configured
main/exchange currency still fails, just one layer down (see Errors, `resolveRate`).

### Server-side flow (`payment.service.ts:28-90`)

1. `resolveRate(organizationId, currency)` (`debt.service.ts:25-38`): `rate=1` if `currency ===
   config.mainCurrency`; else `currency` must equal `config.exchangeCurrency` and
   `rate=config.exchangeRate`; else `422 VALIDATION_ERROR` on field `currency`.
2. `amountMain = toMain(input.amount, rate)` — **multiplication**, see §Money.
3. Load debt (404 if missing); `debt.status !== "open"` → `409 DEBT_NOT_OPEN`
   (`payment.service.ts:37-39`).
4. If `amountMain > debt.remaining`: overshoot `= round2(amountMain - debt.remaining)`. If
   `overshoot <= 0.01` (`OVERSHOOT_TOLERANCE`, `payment.service.ts:22`), **clamp**
   `amountMain = round2(debt.remaining)`; otherwise `422 PAYMENT_EXCEEDS_BALANCE` with
   `details:{remaining}` (`:41-53`).
5. Inside one Mongo transaction: `applyPaymentToDebt` — a guarded `findOneAndUpdate` on
   `{status:"open", remaining:{$gte:amountMain}}`, `$inc {paid:+amountMain, remaining:-amountMain}`
   (`debt.actions.ts:58-68`). If it returns `null` (a concurrent payment won the race since the
   pre-check), `409 PAYMENT_EXCEEDS_BALANCE` again — **but this time with no `details` key**
   (`payment.service.ts:59-68`).
6. `markDebtPaidIfSettled`: guarded update, only fires when `remaining <= 0.004`; sets
   `status:"paid", remaining:0` exactly (`debt.actions.ts:83-92`, called at
   `payment.service.ts:70`).
7. Insert the `Payment` doc, `status:"completed"` (`payment.actions.ts:15-39`).

### Response — `201`, `publicPayment` (see §Response shape below), message `"Payment recorded"`
(`debt.controller.ts:98`).

---

## 6. `POST /debts/:id/write-off` (`debts:write_off`)

`debt.route.ts:67-74` → `writeOffDebt` (`debt.controller.ts:79-86`) →
`debt.service.ts:writeOffDebt` (`:88-101`) → `debt.actions.ts:writeOffDebtById` (`:120-141`).

### Body — `writeOffSchema` (`debt.validation.ts:23`)

`{ reason: reasonSchema }`, `.strict()`. `reasonSchema = z.string().trim().min(1).max(500)`
(`common.validation.ts:43`) — required, non-empty.

### Server-side flow

`writeOffDebtById` is a guarded aggregation-pipeline update: only matches a debt with
`status:"open"` **and** `remaining:{$gt:0}` (`debt.actions.ts:126-127`). On match it atomically
sets, **from the live `$remaining` field, not from any client input**:
`writtenOffAmount = $remaining`, `remaining = 0`, `status = "written_off"`, `writtenOffAt = now`,
`writtenOffBy`, `writeOffReason` (`debt.actions.ts:128-140`). `paid` is untouched — a
partially-paid debt keeps its `paid` value; only the leftover `remaining` moves into
`writtenOffAmount` (confirmed by `tests/integration/actions/debt-balance.test.ts:145-163`, where
a debt paid 4 of 10 is written off and `writtenOffAmount` comes back `6`, not `10`).

If the guard doesn't match (debt not open, or `remaining` already 0 — e.g. fully paid), the
action returns `null`; the service re-fetches by id: not found → `404`; found → `409
DEBT_NOT_OPEN` (`debt.service.ts:94-99`). Comment marks this **irreversible in this phase**
(`debt.service.ts:86-88`).

### Response — `200`, `publicDebt`, message `"Debt written off"` (`debt.controller.ts:85`).

---

## 7. `POST /payments/:id/void` (`payments:void`)

`payment.route.ts:15-22` → `voidPayment` (`payment.controller.ts:38-45`) →
`payment.service.ts:voidPayment` (`:94-123`) → `payment.actions.ts:voidPaymentById` (`:50-67`) +
`debt.actions.ts:reversePaymentOnDebt` (`:71-81`).

Note: this route is mounted under `/payments`, not `/debts/:id/payments` — it takes a
**payment** id (`payment.route.ts:16`, `idParamSchema`), not a debt id.

### Body — `voidSchema` (`payment.validation.ts:14`)

`{ reason: reasonSchema }`, `.strict()` — same shape as write-off's body.

### Server-side flow (`payment.service.ts:94-123`)

1. Load payment by id; `404` if missing/wrong org (`:100-101`).
2. Inside one transaction: `voidPaymentById`, guarded on `status:"completed"` → sets
   `status:"voided", voidedAt, voidedBy, voidReason` (`payment.actions.ts:50-67`). Returns `null`
   if already voided → `409 PAYMENT_ALREADY_VOIDED` (`payment.service.ts:107`).
3. Load the payment's debt; `404` if missing (defensive) (`:109-110`).
4. If `debt.status === "written_off"` → `409 DEBT_WRITTEN_OFF` (`:111-113`) — this rolls back
   the whole transaction (Mongo transaction), so the payment stays `"completed"`, not `"voided"`,
   despite step 2 having applied the update earlier in the same transaction.
5. `reversePaymentOnDebt`: guarded on `debt.status in ["open","paid"]`,
   `$inc {paid:-amountMain, remaining:+amountMain}`, `$set {status:"open"}` **unconditionally**
   (`debt.actions.ts:71-81`) — voiding a payment on a still-`open` debt (not the one that closed
   it) is allowed; it just adds the amount back and re-asserts `status:"open"` (a no-op on
   status, real effect on `remaining`/`paid`). If this returns `null` (race: debt became
   `written_off` between step 3's read and this write) → `409 DEBT_WRITTEN_OFF` again
   (`:115-116`).

### Response — `200`, `publicPayment`, message `"Payment voided"` (`payment.controller.ts:44`).

---

## Response shape — `publicDebt`

`debt.controller.ts:15-41`. Wire id key is **`id`** (Mongoose virtual getter, hex string), never
`_id` (`:21`).

| key | type | source line | populated? |
|---|---|---|---|
| `id` | `string` | `:21` | — |
| `customerId` | `string` | `:22` | **bare id string**, not populated |
| `source` | `"sale" \| "manual"` | `:23` | — |
| `saleId` | `string \| undefined` | `:24` | **bare id string**, not populated |
| `description` | `string \| undefined` | `:25` | — |
| `principal` | `number` | `:26` | — |
| `paid` | `number` | `:27` | — |
| `remaining` | `number` | `:28` | **stored**, not derived (see §Status model) |
| `dueDate` | `Date` (ISO string on the wire) | `:29` | — |
| `status` | `"open"\|"paid"\|"written_off"\|"cancelled"` | `:30` | **never `"overdue"`** — see §Status model |
| `writtenOffAmount` | `number` | `:31` | amount at time of write-off, not `principal` |
| `writtenOffAt` | `Date \| undefined` | `:32` | — |
| `writtenOffBy` | `string \| undefined` | `:33` | **bare id string**, not populated |
| `writeOffReason` | `string \| undefined` | `:34` | — |
| `cancelledAt` | `Date \| undefined` | `:35` | — |
| `createdAt` | `Date` | `:36` | — |
| `updatedAt` | `Date` | `:37` | — |
| `isOverdue` | `boolean` | `:38` | **computed at response time**, see §Status model |
| `daysOverdue` | `number` | `:39` | **computed at response time**, `0` when not overdue |

`createdBy` exists on the `IDebt` model (`debt.model.ts:32`) but is **not** included in
`publicDebt` — do not expect it on the wire.

No `currency` field exists on Debt at all (`debt.model.ts:16-35` has none) — `principal`/`paid`/
`remaining`/`writtenOffAmount` are implicitly in the organization's main currency (see §Money).

## Response shape — `publicPayment`

`payment.controller.ts:11-27`. Wire id key is **`id`**, never `_id` (`:12`). Exported and reused
by `debt.controller.ts` for both the create-payment and list-payments responses (comment,
`payment.controller.ts:9-10`).

| key | type | source line | populated? |
|---|---|---|---|
| `id` | `string` | `:12` | — |
| `debtId` | `string` | `:13` | **bare id string** |
| `customerId` | `string` | `:14` | **bare id string**, denormalized from the debt |
| `currency` | `string` (3-letter) | `:15` | currency the payment was received in |
| `exchangeRate` | `number` | `:16` | frozen at write time |
| `amount` | `number` | `:17` | in `currency` |
| `amountMain` | `number` | `:18` | in org main currency; this is what moved the debt's balance |
| `note` | `string \| undefined` | `:19` | — |
| `status` | `"completed" \| "voided"` | `:20` | — |
| `voidedAt` | `Date \| undefined` | `:21` | — |
| `voidedBy` | `string \| undefined` | `:22` | **bare id string** |
| `voidReason` | `string \| undefined` | `:23` | — |
| `receivedBy` | `string` | `:24` | **bare id string**, required (model has it `required:true`, `payment.model.ts:48`) |
| `createdAt` | `Date` | `:25` | — |
| `updatedAt` | `Date` | `:26` | — |

No populated sub-objects anywhere in either mapper — confirmed by `grep -n "populate("` across
`services/debt.service.ts`, `services/payment.service.ts`, `db/actions/debt.actions.ts`,
`db/actions/payment.actions.ts`, `controller/debt.controller.ts`, `controller/payment.controller.ts`:
zero matches.

---

## The status model

- Stored `Debt.status` enum is exactly `["open", "paid", "written_off", "cancelled"]`
  (`debt.model.ts:58-62`). **`"overdue"` is never a stored status.**
- `"overdue"` exists in two other places only:
  - as a `?status=overdue` **query filter alias** on `GET /debts`, rewritten server-side to
    `status:"open" AND dueDate<now AND remaining>0` (`debt.actions.ts:162-165`);
  - as the **computed** `isOverdue`/`daysOverdue` response fields, built fresh on every response
    from `isOverdue(debt, now)` = `status==="open" && dueDate<now && remaining>0`
    (`debt.actions.ts:146-149`, called at `debt.controller.ts:17`), with `daysOverdue =
    Math.floor((now - dueDate)/86_400_000)` when overdue, else `0` (`debt.controller.ts:18`).
    Doc-comment: "`isOverdue`/`daysOverdue` are computed at response time (design spec D8 —
    overdue is never stored)" (`debt.controller.ts:13-14`).
- `remaining` **is a stored field** (`debt.model.ts:24,55`), not derived at read time. It is
  mutated only through guarded atomic `$inc`/pipeline updates in `debt.actions.ts` — never
  read-then-write (comment, `debt.model.ts:12-14`, "D10"). The declared invariant, checked by
  backend tests after every mutation, is `principal === paid + remaining + writtenOffAmount`
  (`debt.model.ts:9-14`; asserted in `tests/integration/debts/payments.test.ts:72-74` and
  `tests/integration/actions/debt-balance.test.ts:161-162`).
- When a payment brings `remaining` to `<= 0.004` (the **settlement tolerance**, distinct from
  the payment-service's 0.01 **overshoot tolerance**), `markDebtPaidIfSettled` sets
  `status:"paid", remaining:0` exactly, inside the same transaction as the payment
  (`debt.actions.ts:83-92`, `payment.service.ts:70`).
- Voiding the payment that settled a debt reverses this: `reversePaymentOnDebt` restores
  `paid`/`remaining` and unconditionally sets `status:"open"` (`debt.actions.ts:71-81`), even if
  the debt was already `"open"` (voiding one of several payments on a still-open debt).
- Write-off moves whatever `remaining` currently holds into `writtenOffAmount` and zeroes
  `remaining`, leaving `paid` untouched (`debt.actions.ts:128-140`).
- **Frontend implication**: never recompute `isOverdue`, `daysOverdue`, `remaining`, or
  "is this debt basically paid off" client-side — the tolerances (0.01 vs 0.004) are
  server-internal and not exposed; use the fields the server returns.

---

## Money

- All money fields are **numbers**, not strings, capped at 2 decimal places
  (`money.ts:33-39`, `isMoney`), rounded half-away-from-zero via `round2`
  (`money.ts:18`).
- `Debt.principal/paid/remaining/writtenOffAmount` carry **no currency field on the Debt model
  at all** — they are implicitly in the organization's main currency.
- `Payment.currency` is the currency the payment was received in; `Payment.amount` is in that
  currency; `Payment.amountMain` is the same payment converted to the org's main currency
  (`payment.model.ts:13-18`) — `amountMain` is what actually mutates `Debt.paid`/`Debt.remaining`
  (`payment.service.ts:58`, passes `amountMain` not `amount`).
- `Payment.exchangeRate` is frozen onto the record at write time via `resolveRate`
  (`debt.service.ts:25-38`) and never recomputed later even if the org's configured rate changes
  afterward — proven by test: a payment made at rate `0.0078` still reads `exchangeRate: 0.0078`
  and `amountMain: 50` after the org's `CurrencyConfig.exchangeRate` is later changed to `100`
  (`tests/integration/debts/payments.test.ts:111-132`).
- **`exchangeRate` is units of MAIN per one unit of EXCHANGE** — confirmed verbatim in the
  doc-comment: *"`rate` is `CurrencyConfig.exchangeRate`: units of MAIN per one unit of
  EXCHANGE"* (`money.ts:24-27`). Converting exchange→main is therefore **multiplication**:
  `toMain = (amount, rate) => round2(amount * rate)` (`money.ts:28`). `fromMain` divides
  (`money.ts:31`). This is confirmed by the test fixture: main=USD, exchange=KES, rate=`0.0078`;
  paying `6410` KES yields `amountMain: 50` (`6410 * 0.0078 = 50.0`,
  `tests/integration/debts/payments.test.ts:54-58,111-122`) — dividing (`6410 / 0.0078`) would
  give a wildly wrong number, so the frontend must not invert this.
- `resolveRate` (`debt.service.ts:25-38`): `rate=1` when `currency === mainCurrency`; when
  `currency === exchangeCurrency`, `rate = CurrencyConfig.exchangeRate` (live-read at write
  time, not cached); any other currency string → `422 VALIDATION_ERROR` on field `currency`.

---

## Error codes (this scope)

| code | HTTP | class | trigger | file:line |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 422 | `ValidationError` (default code) | any zod schema failure via `validate` middleware; `resolveRate` currency mismatch; `dueDate` before today | `util/errors.ts:100-119`; `middleware/validate.middleware.ts:80`; `debt.service.ts:35-37`; `debt.service.ts:57-59` |
| `NOT_FOUND` | 404 | `NotFoundError` (default code) | customer/organization/debt/payment/currency-config not found, or belongs to another org | `util/errors.ts:77-88`; `debt.service.ts:47,53,82,96`; `payment.service.ts:38,101,110,131`; `debt.service.ts:30` |
| `CUSTOMER_ARCHIVED` | 409 | `ConflictError` | `POST /debts` for a customer whose `status !== "active"` | `debt.service.ts:48-50` |
| `DEBT_NOT_OPEN` | 409 | `ConflictError` | write-off on a debt that isn't `open`+`remaining>0`, **or** recording a payment on a debt whose `status !== "open"` (paid/written_off/cancelled) | `debt.service.ts:98`; `payment.service.ts:39` |
| `PAYMENT_EXCEEDS_BALANCE` | **422 or 409 — same code, two statuses** | `ValidationError` (422, pre-check) / `ConflictError` (409, transaction race) | 422: amount exceeds `remaining` beyond the 0.01 tolerance, before the transaction, `details:{remaining}` set. 409: a concurrent payment won the race inside the transaction — **no `details`** | `payment.service.ts:41-53` (422); `payment.service.ts:59-68` (409) |
| `PAYMENT_ALREADY_VOIDED` | 409 | `ConflictError` | voiding a payment whose `status !== "completed"` | `payment.service.ts:107` |
| `DEBT_WRITTEN_OFF` | 409 | `ConflictError` | voiding a payment whose debt has `status:"written_off"` (checked directly, or lost as a race inside `reversePaymentOnDebt`) | `payment.service.ts:111-113,115-116` |
| `FORBIDDEN` | 403 | `ForbiddenError` (default code) | caller's role lacks the route's permission (`debts:view`/`create`/`write_off`, `payments:create`/`void`) | `middleware/auth.middleware.ts:164-171`; permission strings at `lib/permissions.ts:46-51` |
| `UNAUTHORIZED` | 401 | `UnauthorizedError` | no/expired session | `middleware/auth.middleware.ts:35-50` |

Adjacent, out-of-scope-endpoint but debt-relevant: `CUSTOMER_HAS_OPEN_DEBT` (409) is returned by
the **customer archive** endpoint (not in this scope) when a customer has an `open` debt —
demonstrated by `tests/integration/debts/debts.test.ts:249-272`, which also shows that writing
off the debt clears the block. Not part of the 7 endpoints audited here; mentioned because a
frontend debts/customer flow will likely hit it.

---

## Side effects — summary

- **Record payment**: `paid += amountMain`, `remaining -= amountMain` (guarded, atomic); if
  `remaining` settles to `<=0.004`, `status → "paid"` and `remaining` is forced to exactly `0`.
  Overshoots within 1 cent of `remaining` are silently clamped rather than rejected.
- **Write off**: `writtenOffAmount = remaining (at that instant)`, `remaining → 0`,
  `status → "written_off"`. `paid` is untouched. Only legal from `status:"open"` with
  `remaining>0`. Irreversible in this phase (no un-write-off endpoint exists).
- **Void payment**: `paid -= amountMain`, `remaining += amountMain`, `status` is unconditionally
  forced to `"open"` (reopening a `"paid"` debt, or re-asserting `"open"` as a no-op). Refused
  outright if the debt has since been written off, even though the payment itself would
  otherwise have voided successfully — the whole transaction rolls back, so the payment's
  `status` stays `"completed"`.

---

## Traps for a frontend developer

1. **`PAYMENT_EXCEEDS_BALANCE` is not one error** — it comes back as `422` with
   `details.remaining` set from the pre-transaction check, or as `409` with **no `details`** when
   a concurrent request wins the race. Branch on `code`, and don't assume `details.remaining`
   exists on every occurrence of this code.
2. **`"overdue"` is never a stored `status` value.** It's a query filter alias
   (`?status=overdue`) and a computed pair of response fields (`isOverdue`, `daysOverdue`). A UI
   that does `debt.status === "overdue"` will never match; use `debt.isOverdue`.
3. **Every relation on the wire is a bare id string, never a populated object** —
   `customerId`, `saleId`, `writtenOffBy` on Debt; `debtId`, `customerId`, `voidedBy`,
   `receivedBy` on Payment. There is no sub-object with a `name` or similar to read directly;
   the frontend must fetch/join those separately.
4. **`toMain` multiplies by `exchangeRate`, it does not divide.** `exchangeRate` is "units of
   main per one unit of exchange." Getting this backwards silently produces amounts that are off
   by roughly the square of the real rate.
5. **`DEBT_NOT_OPEN` (409) is shared** between "write off a debt that isn't open" and "pay a
   debt that isn't open" — same code, different endpoints, same generic message ("Debt is not
   open"). Don't infer which happened from the code alone if you display a specific message;
   inspect which endpoint you called.
6. `GET /debts/:id/payments` has no status filter — voided payments are always returned mixed in
   with completed ones; filter client-side if you only want active payments.
7. Voiding a payment forces the debt's `status` to `"open"` unconditionally, even when voiding
   one of several payments on a debt that was already `"open"` — not just when it un-settles a
   `"paid"` debt.
8. `writtenOffAmount` reflects the **balance remaining at the moment of write-off**, not the
   original `principal` — a partially paid debt keeps its `paid` amount, and only the leftover
   moves to `writtenOffAmount`.
9. `dueDate` on `POST /debts` requires a full ISO-8601 datetime (`z.string().datetime()`), not a
   plain `YYYY-MM-DD` date string (which is what a native `<input type=date>` produces without
   conversion).
10. The wire id key is `id` (a string), not `_id`, on both Debt and Payment — and `Debt` carries
    no `currency` field at all, so don't look for one on the debt object.
11. Because every route lists `validate` before `requireAuth`, a request with both an invalid
    body and an expired/missing session comes back `422`, not `401` — don't treat a `422` as
    proof the session is fine.

## Unverified

None of the claims above required guessing — every field, default, status transition, and error
code was traced to a concrete source line or an integration test assertion. If frontend work
later needs the **sale-linked debt creation path** (`source:"sale"`, `saleId` populated) or the
**cancel-debt-on-voided-sale** flow (`cancelDebt`, `debt.actions.ts:103-112`), those are outside
this scope (not one of the 7 endpoints) and were only skimmed, not audited to the same depth —
treat that path as unverified until it's explicitly in scope.

---

## Corrections (2026-09-09, found while building `features/debts` against this file)

Every behavioural claim above was re-verified against the validators, controllers, services,
actions and models and **held**. Some citations drift a line or two after later edits (the
write-off `$set` cited as `128-140` is `130-137` inside an update spanning `126-141`), but no claim
changed meaning. Two consequential things were **omitted**:

**1. The 422 `PAYMENT_EXCEEDS_BALANCE` also carries `errors: { amount }`, not only
`details.remaining`.** `payment.service.ts:46-51` passes a field map as `ValidationError`'s first
argument, and it reaches `ApiError.fieldErrors`. So the 422 already lands on the amount box without
help. Only the 409 — the concurrency-race variant — needs the field mapped by hand, and there the
honest message is "someone else just paid against this debt", **not** a stale remaining figure,
because the 409 carries no `details`.

**2. `z.string().datetime()` rejects an ISO string with an offset, not just a bare date.** Zod
defaults to `offset: false`. This compounds with a timezone trap: `TZDate.prototype.toISOString()`
emits exactly the offset form, and midnight-UTC is *before* start-of-day for any business west of
Greenwich, while the server compares against `startOfDayIn(tz, now)`. So the naive
calendar-date-to-ISO conversion fails twice over — once on format, once on the boundary. Build
noon in the business's timezone and round-trip through a plain `Date` for the `Z` form.

## A gap this contract cannot paper over

**`GET /debts` cannot render the table artboard `2f` draws.** Verified directly:
`listDebtsQuerySchema` (`Backend/src/validators/debt.validation.ts`) is `.strict()` and accepts
only `page`, `limit`, `status` and `customerId` — **no `search`, no date window, no sort param** —
and `publicDebt` (`debt.controller.ts:15-41`) emits `customerId` as a bare id string with **no
name and no phone**. The artboard's first column is customer name over phone.

The Overview's debts panel works only because `GET /dashboard` pre-joins the customer in
`src/services/dashboard/debts.section.ts`; the list endpoint does no such join. Sorting is also a
side effect of the status filter rather than a parameter, so a fixed "Due date" column indicator
would be wrong on four of the six filters.
