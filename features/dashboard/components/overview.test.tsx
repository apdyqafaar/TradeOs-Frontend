import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Overview } from "./overview";

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    currency: "USD",
    isLoading: false,
  }),
}));

const dashboard = vi.fn();
vi.mock("@/features/dashboard/hooks/use-dashboard", () => ({
  useDashboard: () => dashboard(),
}));

// Not in the plan's fixture, and required: `Overview` gates the "New sale"
// button and the First-steps rows on `useCan`, which reads `useSession`, which
// would otherwise fire a real `GET /auth/me` out of happy-dom on every render.
// Granting everything here keeps the permission-gated chrome visible so a test
// asserting its absence is asserting about the data, not about a stub session.
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: () => true,
  usePermissions: () => ["*"],
}));

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

describe("Overview", () => {
  it("renders a seller's own figures and no manager analytics", () => {
    dashboard.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        available: ["organization", "me", "mySales"],
        sections: {
          mySales: {
            today: { count: 12, total: 4320 },
            thisMonth: { count: 210, total: 88400 },
            recent: [],
          },
        },
      },
    });

    render(wrap(<Overview name="Yusuf" />));
    expect(screen.getByText(/my sales today/i)).toBeInTheDocument();
    expect(screen.queryByText(/sales trend/i)).not.toBeInTheDocument();
  });

  it("shows First steps instead of stat cards for a business with no sales", () => {
    dashboard.mockReturnValue({
      isPending: false,
      error: null,
      data: {
        available: ["organization", "me", "sales"],
        sections: {
          // NOTE: `trend7`, not `trend` — verified against
          // ../Backend/src/services/dashboard/sales.section.ts:39.
          sales: {
            today: { revenue: 0, grossProfit: 0, count: 0 },
            thisMonth: { revenue: 0, grossProfit: 0, count: 0 },
            trend7: { granularity: "day", series: [] },
          },
        },
      },
    });

    render(wrap(<Overview name="Amina" />));
    expect(screen.getByText("First steps")).toBeInTheDocument();
  });

  it("shows the error card with the request id when the call fails", () => {
    dashboard.mockReturnValue({
      isPending: false,
      data: undefined,
      error: {
        message: "Something went wrong",
        requestId: "req_abc123",
        status: 500,
      },
    });

    render(wrap(<Overview name="Amina" />));
    expect(screen.getByText(/req_abc123/)).toBeInTheDocument();
  });
});
