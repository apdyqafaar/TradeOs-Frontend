import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TopCustomersReport } from "@/features/reports/types";
import { CustomersReport } from "./customers-report";

const topCustomers = vi.fn();
vi.mock("@/features/reports/hooks/use-reports", () => ({
  useTopCustomers: (...args: unknown[]) => topCustomers(...args),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    currency: "KES",
    timezone: "Africa/Nairobi",
    isLoading: false,
  }),
}));

// `ReportTabs` reads the pathname to mark the current tab.
vi.mock("next/navigation", () => ({
  usePathname: () => "/reports/customers",
}));

const answered = (data: TopCustomersReport) => ({
  data,
  error: null,
  isPending: false,
});

const period = {
  from: "2026-08-31T21:00:00.000Z",
  to: "2026-09-08T21:00:00.000Z",
  timezone: "Africa/Nairobi",
};

const renderWith = (searchParams: string) =>
  render(<CustomersReport />, {
    wrapper: withNuqsTestingAdapter({ searchParams }),
  });

beforeEach(() => {
  topCustomers.mockReset();
});

describe("CustomersReport", () => {
  it("shows spend rows in the business currency and the window the server resolved", () => {
    topCustomers.mockReturnValue(
      answered({
        items: [
          { key: "c1", label: "Bea", value: 80, share: 0.8889 },
          { key: "c2", label: "Ali", value: 10, share: 0.1111 },
        ],
        period,
      }),
    );

    renderWith("");

    expect(screen.getByText("Bea")).toBeInTheDocument();
    // The code, never a symbol, and never hardcoded — it comes from the
    // organization, because no report payload carries a currency at all.
    expect(screen.getByText("KES 80.00")).toBeInTheDocument();
    // `share` is a fraction (0..1) and is rendered as a percentage.
    expect(screen.getByText("88.9%")).toBeInTheDocument();
    // The echo's `to` is the EXCLUSIVE bound, so the caption names the 8th —
    // the last day actually counted — not the 9th.
    expect(screen.getByText("01 Sep 2026 – 08 Sep 2026")).toBeInTheDocument();
  });

  it("survives a row whose label never arrived", () => {
    // `customers/top` projects `label` through a `$lookup` with no `$ifNull`
    // fallback, so a miss emits **no `label` key at all** — unlike
    // `staff/sales`, which sends "Removed member" (contract §3.10). The cost
    // of surviving it is one `??`; without it the row renders blank.
    topCustomers.mockReturnValue(
      answered({
        items: [{ key: "c9", value: 40, share: 1 }],
        period,
      }),
    );

    renderWith("");

    expect(screen.getByText("Unknown customer")).toBeInTheDocument();
  });

  it("withholds the period caption in balance mode, and says why", () => {
    // `by=balance` accepts and echoes the period while ignoring it entirely.
    // A date range printed over a point-in-time figure is a caption that is
    // simply false, so it is not printed.
    topCustomers.mockReturnValue(
      answered({
        items: [{ key: "c1", label: "Bea", value: 80, share: 1 }],
        period,
      }),
    );

    renderWith("?by=balance");

    expect(screen.getByText(/Balances are what is owed/i)).toBeInTheDocument();
    expect(
      screen.queryByText("01 Sep 2026 – 08 Sep 2026"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Most owed/i)).toBeInTheDocument();
  });

  it("normalises a hand-typed limit the endpoint would refuse", () => {
    // `limit` is capped at **50** here, not the list convention's 100, and 51
    // is a 422 rather than a clamp (`report.validation.ts:27`).
    topCustomers.mockReturnValue(answered({ items: [], period }));

    renderWith("?limit=51");

    expect(topCustomers).toHaveBeenCalledWith({ period: "month" }, "spend", 10);
  });
});
