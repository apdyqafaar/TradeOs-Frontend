import { render, screen, within } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PaymentMixReport,
  SalesSummaryReport,
} from "@/features/reports/types";
import { SalesReport } from "./sales-report";

const summaryQuery = vi.fn();
const trendQuery = vi.fn();
const mixQuery = vi.fn();

vi.mock("@/features/reports/hooks/use-reports", () => ({
  useSalesSummary: () => summaryQuery(),
  useSalesTrend: (...args: unknown[]) => trendQuery(...args),
  usePaymentMix: () => mixQuery(),
}));

// A Kenyan shop keeping its books in USD and taking shillings at the counter:
// the case where the tender currency and the main currency differ, which is
// the one `payment-mix.byCurrency` is easiest to misread on.
vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "USD",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports/sales",
}));

const period = {
  from: "2026-08-31T21:00:00.000Z",
  to: "2026-09-08T21:00:00.000Z",
  timezone: "Africa/Nairobi",
};

/** The contract's own hand-computed fixture (`sales.test.ts:62-82`). */
const summary: SalesSummaryReport = {
  revenue: 199,
  salesCount: 5,
  averageSale: 39.8,
  cogs: 124,
  grossProfit: 75,
  marginPct: 0.3769,
  discountTotal: 0,
  collectedAtSale: 113,
  creditIssued: 86,
  voidedCount: 1,
  voidedAmount: 50,
  period,
};

const settled = <T,>(data: T) => ({ data, error: null, isPending: false });

beforeEach(() => {
  summaryQuery.mockReturnValue(settled(summary));
  trendQuery.mockReturnValue(
    settled({ granularity: "day", series: [], period }),
  );
  mixQuery.mockReturnValue(
    settled<PaymentMixReport>({
      // No `credit` row: the API does not zero-fill this array, so a period
      // with no credit sales simply has no credit row (contract §3.3).
      byPaymentStatus: [
        { key: "paid", label: "paid", value: 109, share: 0.5779, count: 3 },
        { key: "partial", label: "partial", value: 10, share: 0.053, count: 1 },
      ],
      byCurrency: [
        { key: "KES", label: "KES", value: 113, share: 1, count: 5 },
      ],
      period,
    }),
  );
});

const renderReport = () =>
  render(<SalesReport />, { wrapper: withNuqsTestingAdapter({}) });

/**
 * The `<li>` of one breakdown row, found by its label.
 *
 * Scoping is load-bearing here rather than tidiness: the figures above the
 * breakdown legitimately print the same strings — `discountTotal` is
 * `USD 0.00` and `collectedAtSale` is `USD 113.00` in this fixture — so an
 * unscoped `getByText` matches two elements and throws. Asserted at the
 * document level, these two tests failed against a component that is correct.
 */
const rowFor = (label: string) => {
  const row = screen.getByText(label).closest("li");
  if (!row) throw new Error(`No breakdown row labelled ${label}`);
  return within(row);
};

describe("SalesReport", () => {
  it("renders marginPct as a percentage, not as the fraction it is", () => {
    // `marginPct` is `round4(grossProfit / revenue)` despite the name — 0.3769
    // is 37.69%, and printing it raw would read as a 0.38% margin.
    renderReport();
    expect(screen.getByText("37.7%")).toBeInTheDocument();
    expect(screen.getByText("USD 75.00")).toBeInTheDocument();
  });

  it("zero-fills the payment statuses the period had none of", () => {
    renderReport();
    expect(screen.getByText("Paid in full")).toBeInTheDocument();
    expect(screen.getByText("Part paid")).toBeInTheDocument();
    // Present as a zero rather than missing: a legend that grew and shrank
    // between periods would make "no credit sales" look like a loading state.
    expect(screen.getByText("On credit")).toBeInTheDocument();
    expect(rowFor("On credit").getByText("USD 0.00")).toBeInTheDocument();
  });

  it("labels a tendered currency without claiming the amount is in it", () => {
    // `key` is the currency handed over at the counter; `value` is
    // `amountPaidMain`, still in the MAIN currency. A row rendered as
    // "KES 113.00" would say 113 shillings when it means 113 dollars' worth of
    // sales tendered in shillings (contract §3.3).
    renderReport();
    expect(screen.getByText("Tendered in KES")).toBeInTheDocument();
    expect(
      rowFor("Tendered in KES").getByText("USD 113.00"),
    ).toBeInTheDocument();
    // Nowhere on the screen, not merely nowhere in the row — the mistake this
    // guards against is formatting `value` with `row.key` as its currency.
    expect(screen.queryByText("KES 113.00")).not.toBeInTheDocument();
  });

  it("asks the trend for the granularity in the URL", () => {
    render(<SalesReport />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?granularity=month" }),
    });
    expect(trendQuery).toHaveBeenCalledWith({ period: "month" }, "month");
  });
});
