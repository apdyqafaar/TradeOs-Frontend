"use client";

import { cn } from "cn";
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import {
  DEBT_STATUS_FILTERS,
  type DebtListParams,
  type DebtStatusFilter,
} from "@/features/debts/types";

/**
 * The label for each of the six values `?status=` accepts.
 *
 * Typed `Record<DebtStatusFilter, string>` rather than written as a list, so
 * the tab strip cannot drift from `DEBT_STATUS_FILTERS`: adding a seventh
 * member to that array is a compile error here until it is labelled, and a
 * label for a value the `.strict()` query schema would 422 on cannot be added
 * at all.
 *
 * `"Overdue"` reads like a status and is not one. It is a **filter alias** the
 * server rewrites to `{ status: "open", dueDate: { $lt: now }, remaining: { $gt:
 * 0 } }` (`../Backend/src/db/actions/debt.actions.ts:162-165`); no debt is ever
 * stored that way. The tab is legitimate; a badge reading it off `debt.status`
 * would not be, which is why `DebtStatus` and `DebtStatusFilter` are separate
 * types.
 */
export const DEBT_STATUS_LABELS: Record<DebtStatusFilter, string> = {
  open: "Open",
  overdue: "Overdue",
  paid: "Paid",
  written_off: "Written off",
  cancelled: "Cancelled",
  all: "All",
};

/**
 * Every filter on this page, in the URL — `CLAUDE.md` and brief §8.4: a
 * filtered list must survive a reload, a shared link and the back button, and
 * none of those work when the state lives in a store.
 *
 * **There are only three keys, and that is the whole of what `GET /debts`
 * accepts.** `listDebtsQuerySchema` is `page`, `limit`, `status`, `customerId`
 * and `.strict()` — no `search`, no date window, no `sort`. So there is no
 * search box on this screen (a fourth key would be a 422, and a client-side
 * filter over one page of N would lie about the rest), and no sortable column
 * (see `<DebtTable>`).
 *
 * `customerId` is deliberately left out too. The API takes it and it is the
 * documented substitute for search, but this page has no control that could set
 * or clear one — a URL-only filter would quietly narrow the list with nothing
 * on screen saying so. A customer's debts are on their own page, which already
 * queries `{ customerId, status: "all" }`.
 *
 * `status` defaults to `"open"` because that is what the backend already does
 * when the key is absent (`debt.validation.ts:18`). Matching it here keeps the
 * URL clean — nuqs drops a key equal to its default — so `/debts` shows the
 * open worklist with a bare query string, and `?status=overdue` says exactly
 * what is on screen.
 */
const DEBT_FILTER_PARSERS = {
  status: parseAsStringLiteral(DEBT_STATUS_FILTERS).withDefault("open"),
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(25),
};

/**
 * The page's filter state, read and written through the query string.
 *
 * `history: "replace"` so switching tabs does not stack a history entry per
 * click, and `scroll: false` so changing the filter does not throw the reader
 * back to the top of the page.
 */
export function useDebtFilters() {
  return useQueryStates(DEBT_FILTER_PARSERS, {
    history: "replace",
    scroll: false,
  });
}

export type DebtFilters = ReturnType<typeof useDebtFilters>[0];
export type SetDebtFilters = ReturnType<typeof useDebtFilters>[1];

/**
 * URL state → `GET /debts` query.
 *
 * A straight copy, unlike `toCustomerListParams`, because none of the three
 * keys has an "empty" value that the `.strict()` schema would refuse: `status`
 * is always one of the six enum members and both numbers are integers ≥ 1.
 * `status` is sent even when it equals the server's own default, which keeps
 * the request self-describing and the React Query key honest about what was
 * asked for.
 */
export function toDebtListParams(filters: DebtFilters): DebtListParams {
  return {
    page: filters.page,
    limit: filters.limit,
    status: filters.status,
  };
}

/**
 * The dom id of one tab, so the panel it controls can point back at it with
 * `aria-labelledby`. Exported because the panel lives in `<DebtsPage>`.
 */
export function debtTabId(status: DebtStatusFilter): string {
  return `debt-tab-${status}`;
}

export interface DebtStatusTabsProps {
  /** The tab currently selected — the `status` in the URL. */
  status: DebtStatusFilter;
  onStatusChange: (status: DebtStatusFilter) => void;
  /** The id of the element these tabs control, for `aria-controls`. */
  panelId: string;
}

/**
 * The six status tabs of artboard `2f`
 * (`docs/design/TradeOs-UI.dc.html:832-840`).
 *
 * Rendered from `DEBT_STATUS_FILTERS` — the same array `DebtStatusFilter` is
 * derived from, transcribed from the backend enum — rather than from a list
 * retyped here, so the strip can never offer a seventh value the `.strict()`
 * query schema would answer with a 422.
 *
 * **The canvas puts a count beside every label and there is none here.**
 * `GET /debts` answers `meta.total` for *the filter it was asked for*, so only
 * the selected tab's count is ever known; the other five would need five more
 * requests on every page load. Six numbers where five are guesses is worse than
 * none, so the count moves to the header, where it can say which filter it
 * counts. Same call `customer-detail.tsx` made about its own tab counts.
 */
export function DebtStatusTabs({
  status,
  onStatusChange,
  panelId,
}: DebtStatusTabsProps) {
  return (
    // Horizontally scrollable rather than wrapping: six labels do not fit a
    // phone, and a tab strip that reflows to two rows stops reading as one
    // control. The page body itself never scrolls sideways.
    <div
      role="tablist"
      aria-label="Debt status"
      className="flex gap-6 overflow-x-auto border-border border-b"
    >
      {DEBT_STATUS_FILTERS.map((value) => {
        const isActive = value === status;

        return (
          <button
            key={value}
            type="button"
            role="tab"
            id={debtTabId(value)}
            aria-selected={isActive}
            aria-controls={panelId}
            onClick={() => onStatusChange(value)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {DEBT_STATUS_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
