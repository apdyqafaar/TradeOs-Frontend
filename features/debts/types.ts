import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * The wire shapes of the seven `/debts` and `/payments` rows in
 * `docs/API-ROUTES.md`.
 *
 * Transcribed from the two shapers every one of those endpoints maps through:
 * `publicDebt` (`../Backend/src/controller/debt.controller.ts:15-41`) and
 * `publicPayment` (`../Backend/src/controller/payment.controller.ts:11-27`).
 * The verified wire contract is `docs/contracts/debts.md`; it wins over the
 * design and over REST intuition, and it is what these types encode.
 *
 * Two rules run through the whole file:
 *
 *   1. **Nothing is populated.** `customerId`, `saleId`, `writtenOffBy`,
 *      `debtId`, `voidedBy` and `receivedBy` are bare id strings — there is no
 *      sub-object with a name on it, confirmed by zero `populate(` calls across
 *      both controllers, both services and both action files. A screen that
 *      wants a customer's name fetches it from `features/customers`.
 *   2. **`dueDate`, `createdAt` and every other date are ISO 8601 strings**,
 *      not `Date`s: the shapers hand Mongoose `Date`s to `JSON.stringify` and
 *      nothing on this side revives them. Feed them to `formatDate(iso,
 *      timezone)` with the business timezone.
 */

/**
 * The **stored** status of a debt, and the whole of it
 * (`../Backend/src/db/models/debt.model.ts:57-62`).
 *
 * `"overdue"` is deliberately absent, and this is the most expensive thing to
 * get wrong in this slice: a debt is never stored as overdue, so
 * `debt.status === "overdue"` matches nothing, ever. Overdue is a query-filter
 * alias and a pair of computed response fields — see `isOverdue` on `Debt` and
 * `DebtStatusFilter` below.
 */
export type DebtStatus = "open" | "paid" | "written_off" | "cancelled";

/**
 * Where the debt came from. `"manual"` is hand-entered (`POST /debts`, the only
 * creation path in this slice); `"sale"` is born from a credit sale and carries
 * a `saleId`. Sale-linked creation is out of scope and the contract marks that
 * path unverified — read a `"sale"` debt, do not try to make one.
 */
export type DebtSource = "sale" | "manual";

/**
 * Money in the organization's **main currency**.
 *
 * The alias exists because a `Debt` carries no `currency` field at all — the
 * model has none (`../Backend/src/db/models/debt.model.ts:16-35`), so every
 * amount below is implicitly in the main currency and there is nothing on the
 * object to read it from. The code comes from `useOrganization().currency`, and
 * `formatMoney(amount, currency)` takes it as a required argument for exactly
 * this reason. Never hardcode one.
 */
export type MainCurrencyAmount = number;

/**
 * A debt, exactly as `publicDebt` shapes it.
 *
 * `createdBy` is on the model (`debt.model.ts:32`) but **not** on the wire —
 * the shaper drops it. Do not expect to know who raised a debt.
 */
export interface Debt {
  id: ObjectId;
  /** Bare id string, on every debt response. */
  customerId: ObjectId;
  /**
   * Name and phone for the customer, **only on `GET /debts`**.
   *
   * Added in `Backend` commit `a117e5e` because the Debts table's first
   * column is the customer's name over their phone (artboard `2f`) and the
   * list previously answered a bare `customerId` — no client could render
   * that column without one request per row. The server resolves it in one
   * `$in` query over the distinct ids in the page, mirroring what
   * `services/dashboard/debts.section.ts` already did for the Overview.
   *
   * **Optional on purpose, in two different senses.** The single-debt
   * responses (`GET /debts/:id`, `POST /debts`, write-off) deliberately do
   * NOT send it — a detail screen is already fetching that customer for their
   * address, so a second copy would be a shape to keep in sync for no gain.
   * And within the list, a customer the server could not resolve leaves the
   * key **absent** rather than blank, so a row never renders an empty string
   * that looks like a nameless customer. Both are pinned by backend tests.
   *
   * The lookup is tenant-filtered, so a debt pointing at another
   * organization's customer resolves to nothing rather than leaking a name.
   */
  customer?: { id: ObjectId; name: string; phone: string };
  source: DebtSource;
  /** Present only when `source === "sale"`. A bare id string. */
  saleId?: ObjectId;
  /**
   * Absent, not null, when unset — `JSON.stringify` drops an `undefined`. The
   * model only requires it for `source: "manual"` (`debt.model.ts:47-51`), so a
   * sale-born debt can arrive without one and a table needs a fallback.
   */
  description?: string;
  /** What was originally owed. */
  principal: MainCurrencyAmount;
  /** The sum of completed payments, in main currency (`Payment.amountMain`). */
  paid: MainCurrencyAmount;
  /**
   * What is still owed — a **stored** field, not a derivation.
   *
   * It is mutated only by guarded atomic updates in `debt.actions.ts`, and the
   * invariant the backend asserts after every one of them is
   * `principal === paid + remaining + writtenOffAmount`. Recomputing it here
   * would race the server and lose: the settlement tolerance (0.004) and the
   * overshoot tolerance (0.01) are server-internal and never on the wire, so a
   * client subtraction can disagree by a cent on the screen whose entire job is
   * saying what someone is owed.
   */
  remaining: MainCurrencyAmount;
  dueDate: string;
  status: DebtStatus;
  /**
   * What was still owed **at the moment of write-off** — not `principal`.
   *
   * A debt paid 4 of 10 and then written off comes back with `paid: 4` and
   * `writtenOffAmount: 6`; `paid` is untouched by a write-off
   * (`debt.actions.ts:126-141`).
   */
  writtenOffAmount: MainCurrencyAmount;
  writtenOffAt?: string;
  /** Bare id string of the Member who wrote it off. Not populated. */
  writtenOffBy?: ObjectId;
  writeOffReason?: string;
  /** Set when the source sale was voided. There is no cancel endpoint here. */
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * **Computed fresh on every response**, never stored: `status === "open" &&
   * dueDate < now && remaining > 0` (`debt.actions.ts:146-149`, called at
   * `debt.controller.ts:17`). This is the field a badge branches on — not
   * `status`, which has no overdue member.
   */
  isOverdue: boolean;
  /**
   * Whole days past `dueDate`, and exactly `0` when `isOverdue` is false
   * (`debt.controller.ts:18`). A `0` is therefore not "due today" — read
   * `isOverdue` first.
   */
  daysOverdue: number;
}

/** A payment's status. There is no "pending": a recorded payment is completed. */
export type PaymentStatus = "completed" | "voided";

/**
 * A repayment against a debt, exactly as `publicPayment` shapes it. The same
 * shape comes back from `POST /debts/:id/payments`, `GET /debts/:id/payments`
 * and `POST /payments/:id/void` — the debt controller imports the payment
 * controller's shaper rather than keeping a second copy
 * (`payment.controller.ts:9-10`).
 *
 * This is the one object in the slice that **does** carry a currency, because a
 * payment can be tendered in the organization's exchange currency while the
 * debt it settles is kept in the main one.
 */
export interface Payment {
  id: ObjectId;
  /** Bare id string of the debt this paid down. */
  debtId: ObjectId;
  /**
   * Bare id string, denormalised from the debt at write time. Load-bearing for
   * cache invalidation: a payment response names the customer whose debt
   * summary just moved, so no second fetch of the debt is needed to find them.
   */
  customerId: ObjectId;
  /** ISO 4217, 3 letters, uppercased by the API. What was handed over. */
  currency: string;
  /**
   * **Units of MAIN per one unit of EXCHANGE**, frozen onto the record at write
   * time and never recomputed — a payment taken at 0.0078 still reads 0.0078
   * after the organization's configured rate is changed to 100.
   *
   * Converting to the books therefore **multiplies**: `amount * exchangeRate`.
   * The inverse reads more naturally out loud, which is exactly how it shipped
   * backwards here once. Do not do the arithmetic by hand — pass this to
   * `formatExchange` in `lib/format/money.ts`, which documents the direction and
   * mirrors the backend's `toMain`.
   */
  exchangeRate: number;
  /** In `currency` — what the customer actually handed over. */
  amount: number;
  /**
   * The same payment in the organization's main currency. **This** is what moved
   * `Debt.paid` and `Debt.remaining` (`payment.service.ts:58` passes
   * `amountMain`, not `amount`), so a payments table that reconciles against a
   * debt balance must sum this column and not `amount`.
   */
  amountMain: MainCurrencyAmount;
  note?: string;
  status: PaymentStatus;
  voidedAt?: string;
  /** Bare id string of the Member who voided it. Not populated. */
  voidedBy?: ObjectId;
  voidReason?: string;
  /** Bare id string of the Member who took the money. Always present. */
  receivedBy: ObjectId;
  createdAt: string;
  updatedAt: string;
}

/**
 * The exact members `?status=` accepts on `GET /debts`, in the order a filter
 * control should offer them — the default first.
 *
 * Copied from the enum at `../Backend/src/validators/debt.validation.ts:18`.
 * The query schema is `.strict()`, so anything not in this list is a 422 rather
 * than a filter the server quietly ignores. Two of the six are not `DebtStatus`
 * values:
 *
 *   - `"overdue"` is an **alias**, rewritten server-side to `{ status: "open",
 *     dueDate: { $lt: now }, remaining: { $gt: 0 } }`
 *     (`../Backend/src/db/actions/debt.actions.ts:162-165`). It is the only way
 *     to get an overdue-only page; there is no stored value to match on.
 *   - `"all"` drops the status clause entirely, still honouring `customerId`
 *     (`debt.actions.ts:166`).
 */
export const DEBT_STATUS_FILTERS = [
  "open",
  "overdue",
  "paid",
  "written_off",
  "cancelled",
  "all",
] as const;

/** `?status=` on `GET /debts`. Derived, so the type cannot drift from the list. */
export type DebtStatusFilter = (typeof DEBT_STATUS_FILTERS)[number];

/**
 * Everything `GET /debts` accepts — pagination plus these two and nothing else
 * (`listDebtsQuerySchema` is `.strict()`).
 *
 * Flat and scalar-only on purpose: this is what `nuqs` keeps in the URL and what
 * goes into the React Query key.
 *
 * There is **no search parameter**. A "find this customer's debts" box has to
 * resolve a customer first through `features/customers` and pass `customerId`
 * here; a free-text filter over debts does not exist and cannot be faked from a
 * single page of results without lying about the rest.
 */
export interface DebtListParams extends PaginationParams {
  /**
   * Omitting this is not "no filter": the backend defaults it to `"open"`
   * (`debt.validation.ts:18`), so a bare `GET /debts` is the open-debts list.
   * Pass `"all"` to actually see everything.
   *
   * It also silently changes the sort. `open` and `overdue` sort
   * `{ dueDate: 1, _id: 1 }` — soonest due first, the collections worklist
   * order. Every other value sorts `{ createdAt: -1, _id: -1 }`, newest first
   * (`debt.actions.ts:178-183`). A table with a fixed "Due date" sort indicator
   * would be wrong on four of the six filters.
   */
  status?: DebtStatusFilter;
  /** 24-hex customer id. The only way to scope the list to one customer. */
  customerId?: ObjectId;
  /**
   * A prefix of the **customer's name** — not the debt's description.
   *
   * Matched server-side against `Customer.searchName`, the maintained
   * lower-cased copy of the name, so a debt is findable by who owes it without
   * the caller knowing their id. Added 2026-09-11.
   *
   * `listDebtsQuerySchema` is `.strict()` and its `search` is
   * `z.string().trim().min(1).max(100)`, so `?search=` is a **422**, not an
   * ignored key. The key is dropped rather than sent empty — see
   * `toDebtListParams`.
   */
  search?: string;
  /**
   * The smallest and largest **`remaining`** — what is still owed, not what the
   * debt started at.
   *
   * Money, so two decimal places; the server refuses a third. Inclusive at
   * both ends, and either may be sent without the other.
   *
   * **A paid debt has `remaining: 0`**, so `status=paid` with a `minAmount`
   * above zero is legitimately empty. That is the filter working, not a bug.
   */
  minAmount?: number;
  maxAmount?: number;
}

/**
 * Everything `GET /debts/:id/payments` accepts: `page` and `limit`, and
 * genuinely nothing else — the schema is
 * `z.object({ ...paginationQuerySchema.shape }).strict()`
 * (`../Backend/src/validators/payment.validation.ts:12`).
 *
 * **There is no status filter here, and sending one is a 422.** Voided payments
 * are always mixed in with completed ones. A "hide voided" control has to filter
 * the fetched page client-side and must not claim to filter the list, because
 * `meta.total` still counts the voided rows.
 */
export type PaymentListParams = PaginationParams;
