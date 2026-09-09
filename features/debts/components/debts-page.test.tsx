import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt } from "@/features/debts/types";
import { ApiError } from "@/lib/api/errors";
import { DebtsPage } from "./debts-page";

const debtsQuery = vi.fn();
vi.mock("@/features/debts/hooks/use-debts", () => ({
  useDebts: (params: unknown) => debtsQuery(params),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const debt = (overrides: Partial<Debt> = {}): Debt => ({
  id: "d1",
  customerId: "cu1",
  customer: { id: "cu1", name: "Mwangi Stores", phone: "+254712445900" },
  source: "manual",
  principal: 223.75,
  paid: 56,
  remaining: 167.75,
  dueDate: "2026-09-21T09:00:00.000Z",
  status: "open",
  writtenOffAmount: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  isOverdue: false,
  daysOverdue: 0,
  ...overrides,
});

/** A settled query over `items`, with `meta.total` counting the whole filter. */
const answered = (items: Debt[], total = items.length) => ({
  data: { items, meta: { page: 1, limit: 25, total, totalPages: 1 } },
  error: null,
  isPending: false,
  isPlaceholderData: false,
  refetch: vi.fn(),
});

/**
 * `hasMemory` matters: without it the testing adapter freezes the search params
 * at the initial value, so a `setFilters` call updates nothing and a test about
 * changing a tab would pass while asserting the *old* query.
 */
const renderPage = (search = "") =>
  render(<DebtsPage />, {
    wrapper: withNuqsTestingAdapter({ searchParams: search, hasMemory: true }),
  });

beforeEach(() => {
  debtsQuery.mockReset();
  debtsQuery.mockReturnValue(answered([debt()]));
});

describe("DebtsPage", () => {
  it("asks for the open worklist by default, which is what the API defaults to", () => {
    renderPage();

    expect(debtsQuery).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      status: "open",
    });
  });

  it("reads the filter out of the URL, so a shared link opens the same list", () => {
    renderPage("?status=overdue&page=2");

    expect(debtsQuery).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      status: "overdue",
    });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Overdue",
    );
  });

  it("counts rows beside the title and never presents a money total there", () => {
    // The artboard draws "USD 4,120.25 outstanding" in this slot. That figure is
    // a sum of `remaining` over every open debt in the business, and `GET /debts`
    // does not carry it — `meta.total` is a row count. Adding up the rows on
    // screen and calling the result "outstanding" would print a number that
    // changes as you page through the list, on a screen about money owed.
    debtsQuery.mockReturnValue(answered([debt()], 12));
    renderPage();

    expect(screen.getByText("12 open")).toBeInTheDocument();
    expect(screen.queryByText(/outstanding/i)).not.toBeInTheDocument();
    // The only USD figures on the page are the row's own columns, all of which
    // are server fields printed verbatim.
    expect(screen.queryByText("USD 4,120.25")).not.toBeInTheDocument();
  });

  it("renders no search box, because the query schema has no search key", () => {
    // `listDebtsQuerySchema` is `.strict()`: `page`, `limit`, `status`,
    // `customerId`. A box that filtered the fetched page client-side would claim
    // to search the debt book while only ever seeing 25 rows of it.
    renderPage();

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it("offers no 'New debt' action while there is no create screen to open", () => {
    // `POST /debts` exists behind `debts:create` and the artboard draws the
    // button, but `app/(app)/debts/new/page.tsx` does not exist — a link to a
    // route with no page is a 404 dressed as an affordance.
    renderPage();

    expect(screen.queryByText(/new debt/i)).toBeNull();
  });

  it("gives a way back to the open list when a tab comes back empty", () => {
    debtsQuery.mockReturnValue(answered([], 0));
    renderPage("?status=cancelled");

    expect(screen.getByText("No cancelled debts")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show open debts" }),
    ).toBeInTheDocument();
  });

  it("does not offer to clear a filter when the default view is empty", () => {
    // `open` is what the server answers with no `status` at all, so an empty
    // open list is the unfiltered empty state — there is no filter to clear, and
    // a button that changed nothing would be the second-worst kind of control.
    debtsQuery.mockReturnValue(answered([], 0));
    renderPage();

    expect(screen.getByText("No open debts")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show open debts" }),
    ).toBeNull();
  });

  it("shows the 403 boundary rather than an error card", () => {
    // Nothing failed and nothing is worth retrying: the caller simply may not
    // read debts. `RouteGuard` gates `/debts` on `debts:view`, so reaching this
    // means a role changed under them.
    debtsQuery.mockReturnValue({
      data: undefined,
      error: new ApiError({
        message: "Forbidden",
        status: 403,
        code: "FORBIDDEN",
      }),
      isPending: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    });
    renderPage();

    expect(screen.getByText("You don't have access to this")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps rows on screen when a refetch over them fails", () => {
    // Stale rows plus an honest card beat a blank page; the opposite — an empty
    // table under an error — would read as "nobody owes this business anything".
    debtsQuery.mockReturnValue({
      ...answered([debt()]),
      error: new ApiError({
        message: "Service unavailable",
        status: 503,
        code: "INTERNAL_ERROR",
        requestId: "req-77",
      }),
    });
    renderPage();

    expect(screen.getByText("Mwangi Stores")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable");
  });

  it("goes back to page 1 when the status changes", async () => {
    // Page 7 of the open debts is not page 7 of the paid ones — and the two are
    // not even sorted the same way, since the sort follows the filter.
    renderPage("?status=open&page=7");

    await userEvent.click(screen.getByRole("tab", { name: "Paid" }));

    expect(debtsQuery).toHaveBeenLastCalledWith({
      page: 1,
      limit: 25,
      status: "paid",
    });
  });
});
