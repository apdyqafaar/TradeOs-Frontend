import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ListedCustomer } from "@/features/customers/types";
import { CustomerTable } from "./customer-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const customer = (
  overrides: Partial<ListedCustomer> = {},
  stats: Partial<ListedCustomer["stats"]> = {},
): ListedCustomer => ({
  id: "c1",
  name: "Juma Kiosk",
  phone: "+255754221900",
  status: "active",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
  ...overrides,
  stats: {
    outstanding: 0,
    overdueAmount: 0,
    overdueCount: 0,
    salesTotal: 0,
    salesCount: 0,
    ...stats,
  },
});

const props = {
  meta: undefined,
  currency: "ETB",
  isLoading: false,
  isStale: false,
  emptyState: <p>No customers</p>,
  onPageChange: vi.fn(),
  onLimitChange: vi.fn(),
};

describe("CustomerTable money columns", () => {
  it("shows what a customer owes, in the business's currency code", () => {
    // The number the "Owes the most" ranking sorts by. A sort by a figure the
    // row does not show is not usable — the reader takes the order on trust
    // and cannot tell a leader from a tie.
    render(
      <CustomerTable {...props} rows={[customer({}, { outstanding: 2400 })]} />,
    );

    expect(screen.getByText("ETB 2,400.00")).toBeInTheDocument();
  });

  it("calls out the overdue part of what is owed", () => {
    render(
      <CustomerTable
        {...props}
        rows={[
          customer(
            {},
            { outstanding: 2400, overdueAmount: 900, overdueCount: 1 },
          ),
        ]}
      />,
    );

    expect(screen.getByText("ETB 2,400.00")).toBeInTheDocument();
    expect(screen.getByText(/ETB 900\.00 overdue/)).toBeInTheDocument();
  });

  it("says nothing about overdue when nothing is late", () => {
    // `overdueAmount` is 0 for a customer who owes but is inside their due
    // date. Printing "ETB 0.00 overdue" on every such row would train the
    // reader to ignore the line that matters.
    render(
      <CustomerTable
        {...props}
        rows={[customer({}, { outstanding: 2400, overdueCount: 0 })]}
      />,
    );

    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("shows a dash, not a zero, for a customer who owes nothing", () => {
    // A column of "ETB 0.00" is noise on a list where most people owe nothing,
    // and it reads as a balance that was calculated rather than an absence.
    render(<CustomerTable {...props} rows={[customer()]} />);

    expect(screen.queryByText("ETB 0.00")).not.toBeInTheDocument();
  });

  it("shows what a customer has bought, with the sale count", () => {
    render(
      <CustomerTable
        {...props}
        rows={[customer({}, { salesTotal: 5540, salesCount: 8 })]}
      />,
    );

    expect(screen.getByText("ETB 5,540.00")).toBeInTheDocument();
    expect(screen.getByText("8 sales")).toBeInTheDocument();
  });

  it("says 1 sale, not 1 sales", () => {
    render(
      <CustomerTable
        {...props}
        rows={[customer({}, { salesTotal: 900, salesCount: 1 })]}
      />,
    );

    expect(screen.getByText("1 sale")).toBeInTheDocument();
  });

  it("renders a row whose stats are all zero without crashing", () => {
    // The server sends a zeroed `stats` for a customer with no debts and no
    // sales rather than omitting the key — this is the row that proves the
    // cells never reach into `undefined`.
    render(<CustomerTable {...props} rows={[customer()]} />);

    expect(screen.getByText("Juma Kiosk")).toBeInTheDocument();
  });

  it("offers no clickable column headers", () => {
    // The list IS sortable, but through the filter bar: only three of the six
    // columns can be sorted by, and headers that look alike while three
    // silently do nothing are worse than a control listing what it offers.
    render(<CustomerTable {...props} rows={[customer()]} />);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.querySelector("button")).toBeNull();
    }
  });
});
