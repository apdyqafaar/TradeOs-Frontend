import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt } from "@/features/debts/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { DebtDetail } from "./debt-detail";

const debtQuery = vi.fn();
vi.mock("@/features/debts/hooks/use-debt", () => ({
  useDebt: () => debtQuery(),
}));

const customerQuery = vi.fn();
vi.mock("@/features/customers/hooks/use-customer", () => ({
  useCustomer: (id?: string) => customerQuery(id),
}));

// The timeline is exercised in its own spec; here it only has to mount.
vi.mock("@/features/debts/hooks/use-debt-payments", () => ({
  useDebtPayments: () => ({
    isPending: false,
    error: null,
    data: { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } },
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/debts/hooks/use-debt-mutations", () => ({
  useRecordPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useWriteOffDebt: () => ({ mutate: vi.fn(), isPending: false }),
  useVoidPayment: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    currency: "USD",
    isLoading: false,
  }),
}));

vi.mock("@/features/organization/hooks/use-currency-config", () => ({
  useCurrencyConfig: () => ({
    mainCurrency: "USD",
    exchangeCurrency: "USD",
    exchangeRate: 0,
    hasExchange: false,
    isLoading: false,
  }),
}));

let granted = new Set<string>();
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (...required: string[]) => required.every((p) => granted.has(p)),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NuqsTestingAdapter>{children}</NuqsTestingAdapter>
);

const debt = (overrides: Partial<Debt> = {}): Debt => ({
  id: "d1",
  customerId: "cu1",
  source: "manual",
  description: "Two sacks of maize",
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

const loaded = (overrides: Partial<Debt> = {}) => ({
  isPending: false,
  error: null,
  data: debt(overrides),
  refetch: vi.fn(),
});

const customer = {
  isPending: false,
  error: null,
  data: {
    customer: {
      id: "cu1",
      name: "Mwangi Stores",
      phone: "+254 712 445 900",
      address: "Eastleigh, Nairobi",
      status: "active" as const,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
    debtSummary: { open: 1, overdue: 0, totalRemaining: 167.75 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  granted = new Set([
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.PAYMENTS_CREATE,
    PERMISSIONS.DEBTS_WRITE_OFF,
  ]);
  debtQuery.mockReturnValue(loaded());
  /*
   * Faithful to React Query v5: a query disabled by an `undefined` id reports
   * `isPending: true` for ever (status "pending", fetchStatus "idle") and
   * never carries data. The component has to read that as "no customer to
   * show", not as "still loading" — which is what the `canViewCustomers &&`
   * guard on the skeleton is for.
   */
  customerQuery.mockImplementation((id?: string) =>
    id ? customer : { isPending: true, error: null, data: undefined },
  );
});

describe("DebtDetail", () => {
  it("joins the customer in, because the debt carries only an id", () => {
    // `publicDebt` emits `customerId` as a bare id string — there is no
    // `populate` anywhere in the debts backend path, so the name, phone and
    // address are a second request.
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(
      screen.getByRole("heading", { name: "Mwangi Stores" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("+254 712 445 900 · Eastleigh, Nairobi"),
    ).toBeInTheDocument();
    expect(screen.getByText("due 21 Sep 2026")).toBeInTheDocument();
  });

  it("does not fetch a customer it has no permission to read", () => {
    granted.delete(PERMISSIONS.CUSTOMERS_VIEW);
    render(<DebtDetail debtId="d1" />, { wrapper });

    // `undefined` disables the query rather than firing a guaranteed 403.
    expect(customerQuery).toHaveBeenCalledWith(undefined);
    // And nothing is invented in its place.
    expect(screen.getByRole("heading", { name: "Debt" })).toBeInTheDocument();
    expect(screen.getByText("Customer cu1")).toBeInTheDocument();
  });

  it("reads overdue off the server's own field, never off the status", () => {
    // `"overdue"` is not a value a debt can hold: the stored status stays
    // `open`, and the badge comes from `isOverdue` / `daysOverdue`, which the
    // API recomputes on every response against its own clock.
    debtQuery.mockReturnValue(loaded({ isOverdue: true, daysOverdue: 12 }));
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(screen.getByText("12 d overdue")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("hides each action from a member who lacks its permission", () => {
    granted.delete(PERMISSIONS.DEBTS_WRITE_OFF);
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(
      screen.getByRole("button", { name: "Record payment" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Write off" }),
    ).not.toBeInTheDocument();
  });

  it("hides both actions once the debt is no longer open", () => {
    // Both endpoints answer 409 DEBT_NOT_OPEN for anything but `open`, so a
    // button here could only ever fail.
    debtQuery.mockReturnValue(loaded({ status: "paid", remaining: 0 }));
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(
      screen.queryByRole("button", { name: "Record payment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Write off" }),
    ).not.toBeInTheDocument();
  });

  it("hides Write off on an open debt with nothing left on it", () => {
    // `writeOffDebtById` matches only `status: "open"` AND `remaining > 0`.
    debtQuery.mockReturnValue(loaded({ remaining: 0 }));
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(
      screen.queryByRole("button", { name: "Write off" }),
    ).not.toBeInTheDocument();
  });

  it("shows the write-off reason once the debt is closed that way", () => {
    debtQuery.mockReturnValue(
      loaded({
        status: "written_off",
        remaining: 0,
        writtenOffAmount: 167.75,
        writtenOffAt: "2026-09-25T09:00:00.000Z",
        writeOffReason: "Shop closed, balance unrecoverable",
      }),
    );
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(
      screen.getByText(
        /Written off on 25 Sep 2026 — Shop closed, balance unrecoverable\./,
      ),
    ).toBeInTheDocument();
  });

  it("treats a 404 as a missing debt rather than an error card", () => {
    debtQuery.mockReturnValue({
      isPending: false,
      data: undefined,
      error: new ApiError({
        message: "Debt not found",
        status: 404,
        code: API_ERROR_CODE.NOT_FOUND,
      }),
      refetch: vi.fn(),
    });
    render(<DebtDetail debtId="d1" />, { wrapper });

    expect(screen.getByText(/this debt isn.t here/i)).toBeInTheDocument();
  });

  it("treats a malformed id's 422 as missing too", () => {
    // `validate({ params: idParamSchema })` runs before the handler, so
    // /debts/abc is a 422 and never reaches the lookup.
    debtQuery.mockReturnValue({
      isPending: false,
      data: undefined,
      error: new ApiError({
        message: "Validation failed",
        status: 422,
        code: API_ERROR_CODE.VALIDATION_ERROR,
        fieldErrors: { id: "Invalid id" },
      }),
      refetch: vi.fn(),
    });
    render(<DebtDetail debtId="abc" />, { wrapper });

    expect(screen.getByText(/this debt isn.t here/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid id/i)).not.toBeInTheDocument();
  });
});
