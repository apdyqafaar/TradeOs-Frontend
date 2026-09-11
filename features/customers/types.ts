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
 * A customer **as a row of `GET /customers`** — the nine shared fields plus
 * the figures the list can be ranked by.
 *
 * Separate from `Customer` rather than an optional field on it, and the type
 * checker is what forced the distinction: `POST`, `PATCH` and `DELETE` all
 * answer through the same `publicCustomer` shaper and carry **no** stats, so
 * `stats` on `Customer` would have been a lie in three places and an optional
 * one would have pushed a `?.` into every call site. Same split as
 * `ListedMember` against `PublicMember`.
 *
 * **Present on every row of the list, whatever the sort.** Sorting by a number
 * the row does not show is not a usable screen, and stats that appeared only
 * under some sorts would make the table change shape when somebody changed the
 * order.
 */
export interface ListedCustomer extends Customer {
  stats: CustomerStats;
}

/**
 * What a customer owes and what they have bought.
 *
 * Every figure is in the organization's **main currency** — these are sums of
 * `Debt.remaining` and `Sale.total`, both stored in main currency, so nothing
 * here needs converting.
 *
 * `overdueAmount` is computed, never stored: a debt is overdue when it is
 * `open ∧ dueDate < now ∧ remaining > 0`, evaluated at request time. Two
 * requests a second apart can legitimately disagree across midnight.
 *
 * `salesTotal` counts **completed sales only** — a voided sale is not a sale,
 * and counting one would make the best customer the one whose sales were
 * reversed.
 */
export interface CustomerStats {
  /** Sum of `remaining` over this customer's open debts. */
  outstanding: number;
  /** The part of `outstanding` that is past its due date. */
  overdueAmount: number;
  overdueCount: number;
  /** Sum of `Sale.total` over completed sales. Voided sales excluded. */
  salesTotal: number;
  salesCount: number;
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
 * How the customer list may be ordered.
 *
 * `name` is the cheap path the endpoint has always had. The other three are
 * **aggregates over other collections** — Debt for the first two, Sale for the
 * third — so the server has to join, compute and sort before it paginates.
 * Sorting a page that has already been fetched sorts twenty-five rows and lies
 * about every other page, which is the same failure this codebase records for
 * client-side filtering.
 */
export const CUSTOMER_SORTS = [
  "name",
  "outstanding",
  "overdue",
  "sales",
] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/**
 * Everything `GET /customers` accepts (`listCustomersQuerySchema` is
 * `.strict()`, so anything else is a 422 rather than an ignored key).
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
  /**
   * Added 2026-09-11, for "who owes me the most" and "who buys the most".
   *
   * Defaults to `name` server-side. The other three sort on a joined
   * aggregate, which is materially more expensive — see `CUSTOMER_SORTS`.
   */
  sort?: CustomerSort;
  /**
   * `asc` for `name`, `desc` for the three aggregates, which is what each one
   * is actually asked for: customers alphabetically, but debts and sales
   * biggest-first. Sent explicitly so the request says what it wants rather
   * than relying on a default that differs per sort.
   */
  order?: "asc" | "desc";
  /**
   * Only customers with at least one **overdue** debt.
   *
   * Distinct from `sort=overdue`, which orders everyone by how much is
   * overdue and still lists the people who owe nothing. This is the collections
   * worklist: the ones to call today.
   */
  hasOverdue?: boolean;
}
