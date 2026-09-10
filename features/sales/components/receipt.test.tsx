import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/features/sales/types";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import { Receipt } from "./receipt";

const saleQuery = vi.fn();
vi.mock("@/features/sales/hooks/use-sale", () => ({
  useSale: () => saleQuery(),
}));

const customerQuery = vi.fn();
vi.mock("@/features/customers/hooks/use-customer", () => ({
  useCustomer: (id: string | undefined) => customerQuery(id),
}));

vi.mock("@/features/sales/hooks/use-sale-mutations", () => ({
  useVoidSale: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

let granted: string[] = [];
vi.mock("@/features/auth/hooks/use-permission", () => ({
  useCan: (...required: string[]) =>
    required.every((permission) => granted.includes(permission)),
}));

vi.mock("@/features/organization/hooks/use-organization", () => ({
  useOrganization: () => ({
    timezone: "Africa/Nairobi",
    currency: "USD",
    isLoading: false,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: "s1",
  number: "S-000129",
  customerId: "cu-1",
  items: [
    {
      productId: "p1",
      name: "Rice 5kg",
      unit: "bag",
      quantity: 3,
      unitPrice: 12.5,
      costPrice: 9,
      discount: 0,
      lineTotal: 37.5,
    },
    {
      productId: "p2",
      name: "Sugar",
      unit: "kg",
      quantity: 1.5,
      unitPrice: 2.5,
      costPrice: 1.8,
      discount: 0.25,
      lineTotal: 3.5,
    },
  ],
  subtotal: 41,
  discount: 1,
  total: 40,
  payment: {
    currency: "USD",
    exchangeRate: 1,
    amountTendered: 50,
    amountPaidMain: 40,
    change: 10,
    amountDue: 0,
  },
  paymentStatus: "paid",
  status: "completed",
  soldBy: "mem-1",
  createdAt: "2026-09-07T11:32:00.000Z",
  updatedAt: "2026-09-07T11:32:00.000Z",
  ...overrides,
});

const loaded = (overrides: Partial<Sale> = {}) => ({
  isPending: false,
  error: null,
  data: sale(overrides),
  refetch: vi.fn(),
});

const failed = (error: ApiError) => ({
  isPending: false,
  error,
  data: undefined,
  refetch: vi.fn(),
});

beforeEach(() => {
  members.names = {};
  vi.clearAllMocks();
  granted = ["sales:void", "customers:view", "debts:view"];
  customerQuery.mockReturnValue({
    isPending: false,
    error: null,
    data: {
      customer: {
        id: "cu-1",
        name: "Mwangi Stores",
        phone: "+254 712 445 900",
        address: "Eastleigh, Nairobi",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      debtSummary: { open: 0, overdue: 0, totalRemaining: 0 },
    },
  });
});

describe("Receipt", () => {
  it("prices every line from the sale's own snapshot", () => {
    // `items[].unitPrice` is frozen at sale time. Re-pricing a line from
    // `GET /products/:id` would show a customer holding this slip a number
    // they were never charged.
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    expect(screen.getByText("S-000129")).toBeInTheDocument();
    expect(screen.getByText("USD 12.50")).toBeInTheDocument();
    expect(screen.getByText("3 bag")).toBeInTheDocument();
    // 3 dp quantities are real here — goods sold by weight.
    expect(screen.getByText("1.5 kg")).toBeInTheDocument();
    expect(screen.getByText("USD 41.00")).toBeInTheDocument();
    // The order-level discount is a separate amount from the line ones.
    expect(screen.getByText("−USD 1.00")).toBeInTheDocument();
    // Total and Paid are the same figure on a fully-paid sale, so both match.
    expect(screen.getAllByText("USD 40.00")).toHaveLength(2);
  });

  it("says which amounts are in the tendered currency and which are not", () => {
    // `amountTendered` and `change` are in `payment.currency`; `amountPaidMain`,
    // `amountDue` and every total are in the main currency. There is no
    // `amountTenderedMain` to shortcut the comparison, and a receipt that mixes
    // them is the failure `docs/contracts/sales.md` trap 5 exists to prevent.
    saleQuery.mockReturnValue(
      loaded({
        payment: {
          currency: "KES",
          exchangeRate: 0.0077,
          amountTendered: 7280,
          amountPaidMain: 40,
          change: 5,
          amountDue: 0,
        },
      }),
    );
    render(<Receipt saleId="s1" />);

    expect(screen.getByText("KES 7,280.00")).toBeInTheDocument();
    // The conversion MULTIPLIES by the rate — the direction that shipped
    // backwards once. 7280 * 0.0077 = 56.056 → 56.06.
    expect(screen.getByText(/≈ USD 56\.06 @ 0\.0077/)).toBeInTheDocument();
    // Change is the odd one out, and the label says so rather than relying on
    // the reader noticing the code changed.
    expect(screen.getByText("Change (in KES)")).toBeInTheDocument();
    expect(screen.getByText("KES 5.00")).toBeInTheDocument();
    expect(
      screen.getByText(/Tendered and change are in KES/),
    ).toBeInTheDocument();
  });

  it("does not label the currencies when there is only one", () => {
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    expect(screen.getByText("Change")).toBeInTheDocument();
    expect(screen.queryByText(/Tendered and change are in/)).toBeNull();
  });

  it("shows a credit sale's balance and a link to the debt it opened", () => {
    saleQuery.mockReturnValue(
      loaded({
        paymentStatus: "credit",
        debtId: "d-1",
        dueDate: "2026-09-21T00:00:00.000Z",
        payment: {
          currency: "USD",
          exchangeRate: 1,
          amountTendered: 0,
          amountPaidMain: 0,
          change: 0,
          amountDue: 40,
        },
      }),
    );
    render(<Receipt saleId="s1" />);

    expect(screen.getByRole("link", { name: /open debt/i })).toHaveAttribute(
      "href",
      "/debts/d-1",
    );
    expect(screen.getByText("21 Sep 2026")).toBeInTheDocument();
  });

  it("hides the debt link from a caller who may not read debts", () => {
    granted = ["sales:void", "customers:view"];
    saleQuery.mockReturnValue(loaded({ debtId: "d-1" }));
    render(<Receipt saleId="s1" />);

    expect(screen.queryByRole("link", { name: /open debt/i })).toBeNull();
  });

  it("banners a voided sale and offers no second void", () => {
    saleQuery.mockReturnValue(
      loaded({
        status: "voided",
        voidReason: "Duplicate scan",
        voidedBy: "mem-2",
        voidedAt: "2026-09-08T06:12:00.000Z",
      }),
    );
    render(<Receipt saleId="s1" />);

    expect(screen.getByText(/Voided · Duplicate scan/)).toBeInTheDocument();
    expect(screen.getByText("Voided by member mem-2")).toBeInTheDocument();
    expect(screen.getByText("S-000129").className).toContain("line-through");
    expect(screen.queryByRole("button", { name: /^void$/i })).toBeNull();
  });

  it("hides the void control from a caller without sales:void", () => {
    // The Seller preset does not hold it. `CLAUDE.md`: no permission means no
    // control, never a disabled one.
    granted = ["customers:view", "debts:view"];
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    expect(screen.queryByRole("button", { name: /^void$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("carries the DEBT_HAS_PAYMENTS rule on the Void button", () => {
    // The API cannot be asked in advance — whether the debt has been paid
    // against is not on this payload — so the rule is a tooltip and the real
    // refusal is shown in the dialog.
    saleQuery.mockReturnValue(loaded({ debtId: "d-1" }));
    render(<Receipt saleId="s1" />);

    expect(screen.getByRole("button", { name: /^void$/i })).toHaveAttribute(
      "title",
      expect.stringContaining("payment has been taken"),
    );
  });

  it("names the customer with the one extra request it is allowed", () => {
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    expect(customerQuery).toHaveBeenCalledWith("cu-1");
    expect(screen.getByText("Mwangi Stores")).toBeInTheDocument();
    expect(
      screen.getByText(/\+254 712 445 900 · Eastleigh, Nairobi/),
    ).toBeInTheDocument();
  });

  it("does not ask for a customer that does not exist", () => {
    // A walk-in has no `customerId`, and `undefined` disables the query rather
    // than caching a failure under a key nothing invalidates.
    saleQuery.mockReturnValue(loaded({ customerId: undefined }));
    render(<Receipt saleId="s1" />);

    expect(customerQuery).toHaveBeenCalledWith(undefined);
    expect(screen.getByText("Walk-in")).toBeInTheDocument();
  });

  it("keeps the receipt intact when the customer lookup fails", () => {
    // Everything else on this page comes from the sale itself; a failed lookup
    // must not take the totals down with it.
    saleQuery.mockReturnValue(loaded());
    customerQuery.mockReturnValue({
      isPending: false,
      error: new ApiError({
        message: "Customer not found",
        status: 404,
        code: API_ERROR_CODE.NOT_FOUND,
      }),
      data: undefined,
    });
    render(<Receipt saleId="s1" />);

    expect(screen.getByText(/couldn.t be loaded/i)).toBeInTheDocument();
    expect(screen.getAllByText("USD 40.00").length).toBeGreaterThan(0);
  });

  it('names the member who rang the sale up, with the canvas\'s "by"', () => {
    members.names = { "mem-1": "Amina Mohamed" };
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    // "by" is `<MemberRef>`'s `prefix`, so it is one phrase to a screen
    // reader rather than "by" sitting loose beside the name.
    expect(screen.getByText("by Amina Mohamed")).toBeInTheDocument();
  });

  it("never invents a name for the member who rang the sale up", () => {
    saleQuery.mockReturnValue(loaded());
    render(<Receipt saleId="s1" />);

    expect(screen.getByText("Recorded by member mem-1")).toBeInTheDocument();
  });

  it("treats a 404 as a missing receipt, not an error card", () => {
    saleQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Sale not found",
          status: 404,
          code: API_ERROR_CODE.NOT_FOUND,
        }),
      ),
    );
    render(<Receipt saleId="s1" />);

    expect(screen.getByText(/doesn.t exist/i)).toBeInTheDocument();
    expect(screen.queryByText("S-000129")).toBeNull();
  });

  it("treats a malformed id's 422 as missing too", () => {
    // `validate({ params: idParamSchema })` is the first link in the chain, so
    // `/sales/abc` is a 422 before the handler runs. Handling only the 404
    // would show someone who mistyped a URL a red card reading "Invalid id".
    saleQuery.mockReturnValue(
      failed(
        new ApiError({
          message: "Validation failed",
          status: 422,
          code: API_ERROR_CODE.VALIDATION_ERROR,
          fieldErrors: { id: "Invalid id" },
        }),
      ),
    );
    render(<Receipt saleId="abc" />);

    expect(screen.getByText(/doesn.t exist/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid id/i)).toBeNull();
  });
});
