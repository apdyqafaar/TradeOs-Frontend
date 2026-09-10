"use client";

import { cn } from "cn";
import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import type { SaleListParams } from "@/features/sales/types";
import {
  isPeriodError,
  MAX_PERIOD_DAYS,
  PERIOD_ERROR_CODE,
  RANGE_MESSAGES,
  type RangeIssue,
  rangeIssue,
} from "@/lib/period";

/**
 * The date window the list is asking for.
 *
 * `all` and `custom` are **this screen's** values, not the API's:
 * `listSalesQuerySchema` accepts `period` as one of four presets, or `from`
 * and `to` together, or neither — and the object is `.strict()`, so sending
 * `period=all` or `period=custom` is a 422 rather than an ignored key
 * (`../Backend/src/validators/sale.validation.ts:38-49`). Both are translated
 * away in `toSaleListParams` below.
 *
 * `all` is the default because that is what the endpoint does with no date
 * keys at all: **no date filter is applied and every sale ever recorded is in
 * scope** (`docs/contracts/sales.md` §1, proven by `list.test.ts:161-171`). A
 * screen that quietly defaulted to "today" would tell an owner their week was
 * empty.
 */
const PERIOD_OPTIONS = [
  "all",
  "today",
  "week",
  "month",
  "year",
  "custom",
] as const;

type PeriodOption = (typeof PERIOD_OPTIONS)[number];

const PERIOD_LABELS: Record<PeriodOption, string> = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  custom: "Custom range",
};

/**
 * `any` is this screen's "do not filter" and is dropped on the way to the
 * wire: `paymentStatus` is `.optional()` with no "all" member
 * (`sale.validation.ts:44`), so an unset filter is an **absent key**.
 */
const PAYMENT_STATUS_OPTIONS = ["any", "paid", "partial", "credit"] as const;

const PAYMENT_STATUS_LABELS: Record<
  (typeof PAYMENT_STATUS_OPTIONS)[number],
  string
> = {
  any: "Any payment",
  paid: "Paid",
  partial: "Partial",
  credit: "Credit",
};

/**
 * `all` here **is** a real API value and the server's own default
 * (`sale.validation.ts:43`) — which is the one place this list diverges from
 * products and customers, whose lists default to `active` and therefore hide
 * rows until asked. An unfiltered sales list **includes voided sales**. The
 * select says so rather than leaving the reader to notice a struck-through row
 * (`docs/findings/slice3-sales-data.md`).
 */
const STATUS_OPTIONS = ["all", "completed", "voided"] as const;

const STATUS_LABELS: Record<(typeof STATUS_OPTIONS)[number], string> = {
  all: "All sales",
  completed: "Completed",
  voided: "Voided",
};

/**
 * Every filter on this page, in the URL — `CLAUDE.md` and brief §8.4: a
 * filtered list must survive a reload, a shared link and the back button, and
 * none of those work when the state lives in a store.
 *
 * Each parser carries a default, which is what keeps the URL clean: nuqs drops
 * a key whose value equals its default, so `/sales` with nothing filtered has
 * a bare query string.
 *
 * **There is no `search` key, and that is not an oversight.** Brief §6.4 asks
 * for "search by receipt number"; `listSalesQuerySchema` has no `search` param
 * and there is no `GET /sales/number/:number` anywhere in
 * `docs/API-ROUTES.md`. Because the query object is `.strict()`, a search box
 * would produce a 422 rather than an ignored key, and filtering the 25 rows
 * already on screen would search one page of N while looking like it searched
 * the journal. The control is left out rather than built to lie
 * (`docs/contracts/sales.md`, Corrections §5).
 *
 * `customerId` has no control either, but it **is** a parser: it is the key a
 * customer's page needs to deep-link "this customer's sales", and holding it
 * here means such a link is a filtered list — clearable, pageable and
 * shareable — rather than a screen that silently ignores half its URL.
 */
const SALE_FILTER_PARSERS = {
  period: parseAsStringLiteral(PERIOD_OPTIONS).withDefault("all"),
  from: parseAsString.withDefault(""),
  to: parseAsString.withDefault(""),
  paymentStatus: parseAsStringLiteral(PAYMENT_STATUS_OPTIONS).withDefault(
    "any",
  ),
  status: parseAsStringLiteral(STATUS_OPTIONS).withDefault("all"),
  customerId: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(25),
};

/**
 * The page's filter state, read and written through the query string.
 *
 * `history: "replace"` so changing a filter does not stack a history entry per
 * click, and `scroll: false` so committing one does not throw the reader back
 * to the top of the table.
 */
export function useSaleFilters() {
  return useQueryStates(SALE_FILTER_PARSERS, {
    history: "replace",
    scroll: false,
  });
}

export type SaleFilters = ReturnType<typeof useSaleFilters>[0];
export type SetSaleFilters = ReturnType<typeof useSaleFilters>[1];

/**
 * The period contract — `to` is inclusive, the span is capped at 366 days, and
 * breaking either is a 400 with a code that is not `VALIDATION_ERROR`.
 *
 * Defined in `lib/period.ts` and re-exported here, unchanged, so this file's
 * callers keep the names they already import. It moved because the reports
 * slice needs the identical guard on six more screens and the three 400 codes
 * are now real members of `API_ERROR_CODE` — which is what the note that used
 * to sit here said should happen "when whoever builds the shared period picker
 * gets to it".
 */
export {
  isPeriodError,
  MAX_PERIOD_DAYS,
  PERIOD_ERROR_CODE,
  type RangeIssue,
  rangeIssue,
};

/**
 * URL state → `GET /sales` query, and every place the two disagree.
 *
 * Four translations, each of which is a 422 or a 400 if skipped:
 *
 *   - `period: "all"` sends **no date keys at all**, which is how the endpoint
 *     spells "every sale".
 *   - `period: "custom"` sends `from`/`to` — and only when the pair is
 *     complete and inside the 366-day cap. An unusable range drops back to no
 *     date filter rather than posting a guaranteed 400.
 *   - `period` and `from`/`to` are **mutually exclusive**
 *     (`common.validation.ts:82-84`), so a preset never carries a stale range
 *     along with it. `sale.service.ts` would answer 422.
 *   - `paymentStatus: "any"` and `customerId: ""` are dropped, because neither
 *     is a value the schema knows.
 *
 * Done here rather than only in the service because these params are also the
 * React Query key: `{ paymentStatus: undefined }` and `{}` hash to two
 * different keys for one identical request, which is two cache entries and a
 * refetch every time the filter is cleared.
 */
export function toSaleListParams(filters: SaleFilters): SaleListParams {
  const usableRange =
    filters.period === "custom" &&
    rangeIssue(filters.from, filters.to) === null;

  return {
    page: filters.page,
    limit: filters.limit,
    status: filters.status,
    ...(filters.paymentStatus === "any"
      ? {}
      : { paymentStatus: filters.paymentStatus }),
    ...(filters.customerId === "" ? {} : { customerId: filters.customerId }),
    ...(usableRange ? { from: filters.from, to: filters.to } : {}),
    ...(filters.period === "all" || filters.period === "custom"
      ? {}
      : { period: filters.period }),
  };
}

/** True when something other than the page is narrowing the list. */
export function hasActiveFilters(filters: SaleFilters): boolean {
  return (
    filters.status !== "all" ||
    filters.paymentStatus !== "any" ||
    filters.period !== "all" ||
    filters.customerId !== ""
  );
}

/** Everything a "Clear filters" action resets, and nothing else. */
export const CLEARED_FILTERS = {
  period: "all",
  from: "",
  to: "",
  paymentStatus: "any",
  status: "all",
  customerId: "",
  page: 1,
} as const;

const CONTROL =
  "h-[38px] rounded-[10px] border border-border bg-card text-[13px] text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

interface SaleFiltersProps {
  filters: SaleFilters;
  setFilters: SetSaleFilters;
}

/**
 * The filter row for the sales journal — brief §6.4's "date range,
 * `paymentStatus`, `status`".
 *
 * Every control is driven straight from the URL; nothing here keeps its own
 * copy, because there is no text input to run ahead of it (the receipt-number
 * search the brief drew cannot be built — see `SALE_FILTER_PARSERS`).
 *
 * Changing any filter resets `page`, because page 4 of "this month" is not
 * page 4 of "all time".
 */
export function SaleFiltersBar({ filters, setFilters }: SaleFiltersProps) {
  const issue =
    filters.period === "custom" ? rangeIssue(filters.from, filters.to) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="sale-period-filter">
          Date range
        </label>
        <select
          id="sale-period-filter"
          value={filters.period}
          onChange={(event) =>
            void setFilters({
              period: event.target.value as PeriodOption,
              page: 1,
            })
          }
          className={cn(CONTROL, "px-3")}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {PERIOD_LABELS[option]}
            </option>
          ))}
        </select>

        {filters.period === "custom" ? (
          <>
            {/*
              `type="date"` because the value the API wants *is* the control's
              native value — a bare `YYYY-MM-DD` calendar date. Note this is a
              different format from `dueDate` on `POST /sales`, which needs a
              full ISO datetime with a `Z`; the two look interchangeable and a
              swap is a 422 (`docs/contracts/sales.md` trap 2).
            */}
            <label className="sr-only" htmlFor="sale-from-filter">
              From date
            </label>
            <input
              id="sale-from-filter"
              type="date"
              value={filters.from}
              max={filters.to === "" ? undefined : filters.to}
              onChange={(event) =>
                void setFilters({ from: event.target.value, page: 1 })
              }
              aria-invalid={issue !== null ? true : undefined}
              className={cn(CONTROL, "px-3 font-mono")}
            />

            <span aria-hidden="true" className="text-muted-foreground text-xs">
              to
            </span>

            <label className="sr-only" htmlFor="sale-to-filter">
              To date
            </label>
            <input
              id="sale-to-filter"
              type="date"
              value={filters.to}
              min={filters.from === "" ? undefined : filters.from}
              onChange={(event) =>
                void setFilters({ to: event.target.value, page: 1 })
              }
              aria-invalid={issue !== null ? true : undefined}
              className={cn(CONTROL, "px-3 font-mono")}
            />
          </>
        ) : null}

        <label className="sr-only" htmlFor="sale-payment-status-filter">
          Payment
        </label>
        <select
          id="sale-payment-status-filter"
          value={filters.paymentStatus}
          onChange={(event) =>
            void setFilters({
              paymentStatus: event.target.value as SaleFilters["paymentStatus"],
              page: 1,
            })
          }
          className={cn(CONTROL, "px-3")}
        >
          {PAYMENT_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {PAYMENT_STATUS_LABELS[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="sale-status-filter">
          Status
        </label>
        <select
          id="sale-status-filter"
          value={filters.status}
          onChange={(event) =>
            void setFilters({
              status: event.target.value as SaleFilters["status"],
              page: 1,
            })
          }
          className={cn(CONTROL, "px-3")}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {/*
        Two captions, never both. The refusal replaces the explanation, because
        a range that cannot be sent has nothing to explain about inclusivity
        yet — and an unusable range means the table below is still showing
        every sale, which the message has to admit.
      */}
      {filters.period === "custom" ? (
        issue === null ? (
          <p className="text-[12px] text-muted-foreground">
            Both dates are included, so the end date is the last day you will
            see.
          </p>
        ) : (
          <p role="alert" className="text-[12px] text-destructive">
            {RANGE_MESSAGES[issue]} Showing every sale until it is fixed.
          </p>
        )
      ) : null}
    </div>
  );
}
