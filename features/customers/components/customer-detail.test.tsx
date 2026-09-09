import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { CustomerDetail } from "./customer-detail";

/**
 * The task that built this page wrote an equivalent spec, proved these four
 * branches, then deleted it because its file list did not allow a test here.
 * Restored, because the not-found branch in particular is the kind of thing
 * nobody discovers until a real person types a URL.
 */

const detail = vi.fn();
vi.mock("@/features/customers/hooks/use-customer", () => ({
  useCustomer: () => detail(),
}));

const archive = vi.fn();
vi.mock("@/features/customers/hooks/use-customer-mutations", () => ({
  useArchiveCustomer: () => archive(),
  useCreateCustomer: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUpdateCustomer: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock("@/features/auth/hooks/use-permission", () => ({ useCan: () => true }));
vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    currency: "USD",
    isLoading: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NuqsTestingAdapter>{children}</NuqsTestingAdapter>
);

const customer = {
  id: "cu1",
  name: "Bakaara Wholesale",
  phone: "+252 61 234 5678",
  email: "bakaara@example.com",
  address: "Bakaara Market, Mogadishu",
  status: "active" as const,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const loaded = (overrides: Record<string, unknown> = {}) => ({
  isPending: false,
  error: null,
  data: {
    customer: { ...customer, ...overrides },
    debtSummary: { open: 0, overdue: 0, totalRemaining: 0 },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  archive.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  });
});

describe("CustomerDetail", () => {
  it("shows the customer once loaded", () => {
    detail.mockReturnValue(loaded());
    render(<CustomerDetail customerId="cu1" />, { wrapper });

    expect(screen.getByText("Bakaara Wholesale")).toBeInTheDocument();
    // Phone and email share one line, so match on a substring.
    expect(
      screen.getByText(
        (_, el) =>
          el?.textContent?.includes("+252 61 234 5678") === true &&
          el.tagName === "P",
      ),
    ).toBeInTheDocument();
  });

  it("treats a 404 as a missing customer, not an error card", () => {
    detail.mockReturnValue({
      isPending: false,
      data: undefined,
      error: new ApiError({
        message: "Customer not found",
        status: 404,
        code: API_ERROR_CODE.NOT_FOUND,
      }),
    });
    render(<CustomerDetail customerId="cu1" />, { wrapper });

    expect(screen.queryByText("Bakaara Wholesale")).not.toBeInTheDocument();
    expect(screen.getByText(/doesn.t exist/i)).toBeInTheDocument();
  });

  it("treats a malformed id's 422 as missing too, rather than showing 'Invalid id'", () => {
    // `validate({ params: idParamSchema })` runs before the handler, so
    // /customers/abc is a 422, not a 404. Handling only the 404 would show
    // someone who mistyped a URL a red error card reading "Invalid id".
    detail.mockReturnValue({
      isPending: false,
      data: undefined,
      error: new ApiError({
        message: "Validation failed",
        status: 422,
        code: API_ERROR_CODE.VALIDATION_ERROR,
        fieldErrors: { id: "Invalid id" },
      }),
    });
    render(<CustomerDetail customerId="abc" />, { wrapper });

    expect(screen.getByText(/doesn.t exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid id/i)).not.toBeInTheDocument();
  });

  it("banners an archived customer and offers no archive control", () => {
    detail.mockReturnValue(loaded({ status: "archived" }));
    render(<CustomerDetail customerId="cu1" />, { wrapper });

    expect(
      screen.getByText(/cannot be sold to on credit/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^archive$/i }),
    ).not.toBeInTheDocument();
  });

  it("explains a refused archive next to the button that was refused", () => {
    // 409 CUSTOMER_HAS_OPEN_DEBT. A toast would put the reason somewhere
    // other than the control it is about.
    detail.mockReturnValue(loaded());
    archive.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      reset: vi.fn(),
      error: new ApiError({
        message: "This customer has an open debt",
        status: 409,
        code: API_ERROR_CODE.CUSTOMER_HAS_OPEN_DEBT,
      }),
    });

    render(<CustomerDetail customerId="cu1" />, { wrapper });
    expect(screen.getAllByText(/open debt/i).length).toBeGreaterThan(0);
  });
});
