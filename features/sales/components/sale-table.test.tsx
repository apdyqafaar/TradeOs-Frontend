import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/features/sales/types";
import { SaleTable } from "./sale-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The stub map is module state; without this a test that names a member
// leaves them named for every test after it, and the fallback tests pass or
// fail on their position in the file.
beforeEach(() => {
  members.names = {};
});

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
  ],
  subtotal: 37.5,
  discount: 0,
  total: 37.5,
  payment: {
    currency: "USD",
    exchangeRate: 1,
    amountTendered: 40,
    amountPaidMain: 37.5,
    change: 2.5,
    amountDue: 0,
  },
  paymentStatus: "paid",
  status: "completed",
  soldBy: "mem-1",
  createdAt: "2026-09-07T11:32:00.000Z",
  updatedAt: "2026-09-07T11:32:00.000Z",
  ...overrides,
});

const props = {
  meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
  currency: "USD",
  timezone: "Africa/Nairobi",
  isLoading: false,
  isStale: false,
  emptyState: <p>No sales</p>,
  onPageChange: vi.fn(),
  onLimitChange: vi.fn(),
};

describe("SaleTable", () => {
  it("strikes through a voided sale's number and total instead of hiding it", () => {
    // `status` defaults to "all" server-side — unlike every other list in this
    // app — so voided rows are in an unfiltered list, and a void never removes
    // a receipt. Muting is the whole signal that the money did not stick.
    render(
      <SaleTable
        {...props}
        rows={[sale({ status: "voided", number: "S-000117" })]}
      />,
    );

    expect(screen.getByText("S-000117").className).toContain("line-through");
    expect(screen.getByText("USD 37.50").className).toContain("line-through");
  });

  it("names a walk-in but never invents a customer it cannot resolve", () => {
    // `customerId` is a bare id and the list would need one request per distinct
    // customer per page turn to name them. The absence of a customer is itself
    // information, so it is stated; a customer that exists but cannot be named
    // gets the id in a tooltip and the receipt one click away.
    const { rerender } = render(<SaleTable {...props} rows={[sale()]} />);
    expect(screen.getByText("Walk-in")).toBeInTheDocument();

    rerender(<SaleTable {...props} rows={[sale({ customerId: "cu-9" })]} />);
    expect(screen.queryByText("Walk-in")).not.toBeInTheDocument();
    expect(screen.getByText(/Customer cu-9/)).toBeInTheDocument();
  });

  it("names the seller from the shared member directory", () => {
    // The canvas reads "Amina Mohamed" in this column. `soldBy` is a bare
    // Member id, so the name can only come from `GET /members` — one shared
    // request for the whole page, not one per row.
    members.names = { "mem-1": "Amina Mohamed" };
    render(<SaleTable {...props} rows={[sale()]} />);

    expect(screen.getByText("Amina Mohamed")).toBeInTheDocument();
  });

  it("keeps the member id traceable rather than fabricating a name", () => {
    // Nothing in the directory resolves `mem-1` here. A receipt someone is
    // disputing must not carry a name this screen made up, so it falls back to
    // the id — same treatment as the "Who" column in
    // `stock-movements-table.tsx`, which shares this component.
    render(<SaleTable {...props} rows={[sale()]} />);

    expect(screen.getByText("Recorded by member mem-1")).toBeInTheDocument();
  });

  it("counts lines, not units", () => {
    // One line of three bags is one item on this column; `items` rides on the
    // wire in full, so the count costs no extra request.
    render(<SaleTable {...props} rows={[sale()]} />);

    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
