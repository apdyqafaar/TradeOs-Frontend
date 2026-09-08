import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * The wire shapes of the five `/customers` rows in `docs/API-ROUTES.md`.
 *
 * Transcribed from `publicCustomer` in
 * `../Backend/src/controller/customer.controller.ts:13-23`, which is the
 * shaper every one of the five endpoints maps through — list rows, the detail
 * row, the POST response, the PATCH response and the DELETE response are all
 * the same nine fields. `organizationId`, `searchName`, `createdBy` and `__v`
 * live on the model and are dropped by the shaper, so they are not here.
 *
 * `createdAt` / `updatedAt` are ISO 8601 **strings**: JSON has no date type
 * and nothing in this app revives one. Feed them to `formatDate(iso,
 * timezone)` with the business timezone.
 */
export interface Customer {
  id: ObjectId;
  name: string;
  phone: string;
  /**
   * Absent, not null, when unset — the shaper copies `customer.email`, which
   * is `undefined` on a document without one, and `JSON.stringify` drops the
   * key. Stored lower-cased by the model (`lowercase: true`).
   */
  email?: string;
  address?: string;
  notes?: string;
  /**
   * `archived` is the end of the line for the list: `GET /customers` defaults
   * to `status=active`, so an archived customer is invisible unless a filter
   * asks for them. There is no delete.
   */
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

/**
 * A number of debts. **Not money.**
 *
 * This alias exists so the two counts below cannot be read as amounts at a
 * glance. `customerDebtSummary` builds `open` and `overdue` with `$sum: 1`
 * (`../Backend/src/db/actions/debt.actions.ts:197-220`) — they count rows.
 * The design canvas (artboard `2h`) draws both as *USD 0.00*; it is wrong, and
 * `formatMoney(summary.overdue, currency)` would print a currency figure that
 * exists nowhere in the business's books. Task 9 renders these as counts.
 */
export type DebtCount = number;

/** An amount in the organization's main currency, 2 dp — `formatMoney` fodder. */
export type MoneyAmount = number;

/**
 * The debt panel on the customer detail, exactly as the aggregate returns it.
 *
 * Only one of the three fields is money. Every field is always present: the
 * aggregate coalesces a customer with no debts to `{ open: 0, overdue: 0,
 * totalRemaining: 0 }` rather than returning nothing.
 */
export interface CustomerDebtSummary {
  /** How many debts are still open. A count of rows. */
  open: DebtCount;
  /** How many of those open debts are past their due date. A count of rows. */
  overdue: DebtCount;
  /** The sum of `remaining` across the open debts. The one amount here. */
  totalRemaining: MoneyAmount;
}

/**
 * What `useCustomer(id)` hands a component.
 *
 * **The wire is flatter than this** — see `CustomerDetailResponse` — and the
 * service reshapes it. Keeping the customer in its own property is what stops
 * `debtSummary` from being spread through every place a `Customer` is
 * expected, and it means a component can pass `detail.customer` to anything
 * typed for a list row.
 */
export interface CustomerDetail {
  customer: Customer;
  debtSummary: CustomerDebtSummary;
}

/**
 * The raw body of `GET /customers/:id`, before the service reshapes it.
 *
 * `getCustomer` answers `{ ...publicCustomer(customer), debtSummary }`
 * (`../Backend/src/controller/customer.controller.ts:57-64`) — the customer's
 * own fields sit at the **top level** of `data` with `debtSummary` beside
 * them, not nested under a `customer` key. Exported so a test can build the
 * real payload; components use `CustomerDetail`.
 */
export interface CustomerDetailResponse extends Customer {
  debtSummary: CustomerDebtSummary;
}

/**
 * `?status=` on the list.
 *
 * Note `"all"`, which is not a value `Customer.status` can hold — it is the
 * filter's "don't filter" option (`listCustomersQuerySchema`).
 */
export type CustomerStatusFilter = "active" | "archived" | "all";

/**
 * Everything `GET /customers` accepts — pagination plus these two, and
 * nothing else (`listCustomersQuerySchema` is `.strict()`).
 *
 * Flat and scalar-only on purpose: this is what `nuqs` keeps in the URL and
 * what goes into the React Query key.
 */
export interface CustomerListParams extends PaginationParams {
  /**
   * A **prefix** match, 1–100 characters, against the lower-cased name or the
   * normalised phone — `^term`, escaped, not a contains search
   * (`../Backend/src/db/actions/customer.actions.ts:38-42`). "wholesale" finds
   * nothing for "Bakaara Wholesale", and a phone term must be typed without
   * spaces or dashes because the stored value has none.
   */
  search?: string;
  /**
   * Omitting this is not "no filter": the backend defaults it to `"active"`,
   * so archived customers are absent until something asks for `"archived"` or
   * `"all"`.
   */
  status?: CustomerStatusFilter;
}
