import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment } from "@/features/debts/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { PaymentsTimeline } from "./payments-timeline";

const list = vi.fn();
vi.mock("@/features/debts/hooks/use-debt-payments", () => ({
  useDebtPayments: () => list(),
}));

const voidMutation = vi.fn();
vi.mock("@/features/debts/hooks/use-debt-mutations", () => ({
  useVoidPayment: () => voidMutation(),
}));

const can = vi.fn();
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (...required: string[]) => can(...required),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    // A Kenyan shop keeping books in KES and taking dollars at the counter.
    currency: "KES",
    isLoading: false,
  }),
}));

/**
 * The member directory, stubbed.
 *
 * `<MemberRef>` resolves ids through `useMemberNames()`, which reads a shared
 * React Query. Mocking that hook rather than standing up a QueryClient keeps
 * these tests about this component, and lets one line decide whether a member
 * is nameable — which is the only thing the cell branches on.
 */
const members = vi.hoisted(() => ({ names: {} as Record<string, string> }));

vi.mock("@/features/team/hooks/use-member-names", () => ({
  useMemberNames: () => ({
    resolve: (id?: string | null) => (id ? (members.names[id] ?? null) : null),
    display: (id?: string | null) => (id ? (members.names[id] ?? "—") : "—"),
    isLoading: false,
    isError: false,
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NuqsTestingAdapter>{children}</NuqsTestingAdapter>
);

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: "pay1",
  debtId: "d1",
  customerId: "cu1",
  currency: "KES",
  exchangeRate: 1,
  amount: 5000,
  amountMain: 5000,
  status: "completed",
  receivedBy: "mem-42",
  createdAt: "2026-09-08T11:30:00.000Z",
  updatedAt: "2026-09-08T11:30:00.000Z",
  ...overrides,
});

const loaded = (items: Payment[]) => ({
  isPending: false,
  error: null,
  data: {
    items,
    meta: { page: 1, limit: 20, total: items.length, totalPages: 1 },
  },
  refetch: vi.fn(),
});

beforeEach(() => {
  members.names = {};
  vi.clearAllMocks();
  can.mockReturnValue(true);
  voidMutation.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  });
});

describe("PaymentsTimeline", () => {
  it("shows what moved the balance — `amountMain`, in the books' currency", () => {
    // `payment.service.ts` passes `amountMain` to the balance update, so a row
    // rendering `amount` would not reconcile against `Debt.paid` for a payment
    // tendered in the exchange currency.
    list.mockReturnValue(
      loaded([
        payment({
          currency: "USD",
          exchangeRate: 130,
          amount: 50,
          amountMain: 6500,
        }),
      ]),
    );
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(screen.getByText("KES 6,500.00")).toBeInTheDocument();
  });

  it("names the tendered amount on a payment taken in the exchange currency", () => {
    // The conversion MULTIPLIES: 50 USD at 130 KES-per-USD is 6,500 KES. The
    // inverse reads better out loud and is how this repo once printed
    // KES 0.77 for a KES 13,000 tender.
    list.mockReturnValue(
      loaded([
        payment({
          currency: "USD",
          exchangeRate: 130,
          amount: 50,
          amountMain: 6500,
        }),
      ]),
    );
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(screen.getByText("tendered USD 50.00")).toBeInTheDocument();
  });

  it("names the member who took the money", () => {
    members.names = { "mem-42": "Hodan Yusuf" };
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(screen.getByText("Hodan Yusuf")).toBeInTheDocument();
  });

  it("does not invent a name for the member who took the money", () => {
    // The directory is empty here — a removed member, or a caller without
    // `members:view`. The id stays reachable through `title` rather than the
    // cell inventing someone.
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(screen.getByTitle("Received by member mem-42")).toHaveTextContent(
      "—",
    );
  });

  it("keeps a voided payment in the list, struck through and pilled", () => {
    // `GET /debts/:id/payments` has no status filter and its schema is
    // `.strict()`, so voided rows always come back. The trail is the point.
    list.mockReturnValue(
      loaded([
        payment({
          status: "voided",
          voidReason: "Entered twice",
          voidedAt: "2026-09-08T12:00:00.000Z",
        }),
      ]),
    );
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(screen.getByText("Voided")).toBeInTheDocument();
    expect(screen.getByText("Entered twice")).toBeInTheDocument();
    expect(screen.getByText("KES 5,000.00")).toHaveClass("line-through");
  });

  it("offers no void control at all without `payments:void`", () => {
    can.mockReturnValue(false);
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    expect(
      screen.queryByRole("button", { name: /void this payment/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the void control on a written-off debt and says why", () => {
    // Voiding here always ends in 409 DEBT_WRITTEN_OFF with the whole
    // transaction rolled back, so the button could only ever fail.
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="written_off" />, {
      wrapper,
    });

    expect(
      screen.queryByRole("button", { name: /void this payment/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no longer be reversed/i)).toBeInTheDocument();
  });

  it("requires a reason before it will void anything", async () => {
    const mutate = vi.fn();
    voidMutation.mockReturnValue({ mutate, isPending: false, reset: vi.fn() });
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    await userEvent.click(
      screen.getByRole("button", { name: /void this payment/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^void payment$/i }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/say why/i);
  });

  it("explains DEBT_WRITTEN_OFF beside the control, and offers no retry", async () => {
    // The check runs after the void is applied inside the transaction, so the
    // rollback undoes it: nothing partial is committed and a retry fails
    // identically.
    const mutate = vi.fn((_vars, options) => {
      options.onError(
        new ApiError({
          message: "Debt has been written off",
          status: 409,
          code: API_ERROR_CODE.DEBT_WRITTEN_OFF,
        }),
      );
    });
    voidMutation.mockReturnValue({ mutate, isPending: false, reset: vi.fn() });
    list.mockReturnValue(loaded([payment()]));
    render(<PaymentsTimeline debtId="d1" debtStatus="open" />, { wrapper });

    await userEvent.click(
      screen.getByRole("button", { name: /void this payment/i }),
    );
    await userEvent.type(
      screen.getByLabelText(/why is this payment being voided/i),
      "Wrong customer",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^void payment$/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /trying again will fail the same way/i,
    );
  });
});
