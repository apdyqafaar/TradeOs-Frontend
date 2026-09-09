import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Debt } from "@/features/debts/types";
import { DebtTable } from "./debt-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const CUSTOMER_ID = "68c1f0a4e2b9c7d3a1f40b21";

/** Everything a debt carries on every response, with no `customer` key. */
const BASE: Omit<Debt, "customer"> = {
  id: "d1",
  customerId: CUSTOMER_ID,
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
};

/** A row as `GET /debts` shapes it when the server resolved the customer. */
const debt = (overrides: Partial<Debt> = {}): Debt => ({
  ...BASE,
  customer: { id: CUSTOMER_ID, name: "Mwangi Stores", phone: "+254712445900" },
  ...overrides,
});

/**
 * The same row with `customer` **absent**, which is what an unresolved customer
 * actually looks like on the wire — `publicDebt` spreads the key in rather than
 * setting it to `undefined`, so the two cases are distinguishable. Built from
 * `BASE` rather than by deleting a key, so the absence is the fixture's shape
 * and not something a later edit can quietly restore.
 */
const debtWithUnknownCustomer = (): Debt => ({ ...BASE });

const props = {
  meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
  currency: "USD",
  timezone: "Africa/Nairobi",
  isLoading: false,
  isStale: false,
  emptyState: <p>No debts</p>,
  onPageChange: vi.fn(),
  onLimitChange: vi.fn(),
};

describe("DebtTable", () => {
  it("renders the customer's name over their phone from the row itself", () => {
    // The column this screen was blocked on. `GET /debts` used to answer a bare
    // `customerId`; `Backend` a117e5e resolves the customer server-side on this
    // endpoint only, so the cell needs no request of its own.
    render(<DebtTable {...props} rows={[debt()]} />);

    expect(screen.getByText("Mwangi Stores")).toBeInTheDocument();
    expect(screen.getByText("+254712445900")).toBeInTheDocument();
  });

  it("says a customer is unknown rather than rendering a blank name", () => {
    // The key is absent, not blank, when the server could not resolve one, and
    // the lookup behind it is tenant-filtered — so a debt pointing at another
    // business's customer resolves to nothing instead of leaking a name. An
    // empty cell would read as a nameless customer; the id stays traceable.
    render(<DebtTable {...props} rows={[debtWithUnknownCustomer()]} />);

    expect(screen.queryByText("Mwangi Stores")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown customer")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Customer ${CUSTOMER_ID} is not in this`)),
    ).toBeInTheDocument();
  });

  it("takes overdue from `isOverdue`, never from `status`", () => {
    // An overdue debt is stored as `open` — `"overdue"` is a filter alias and a
    // pair of computed response fields, and `debt.status === "overdue"` does not
    // even compile against `DebtStatus`. A table reading the stored status alone
    // would show a column of identical "Open" pills on a collections screen.
    render(
      <DebtTable
        {...props}
        rows={[debt({ status: "open", isOverdue: true, daysOverdue: 12 })]}
      />,
    );

    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.getByText("12 d")).toBeInTheDocument();
  });

  it("shows nothing overdue when the server says the debt is not overdue", () => {
    // `daysOverdue` is exactly `0` whenever `isOverdue` is false, so a `0` means
    // "not overdue" and not "due today". Gating the pill on the number instead
    // of the boolean would be right by accident.
    render(<DebtTable {...props} rows={[debt({ daysOverdue: 0 })]} />);

    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("prints `remaining` as the server sent it, in the organization's currency", () => {
    // `remaining` is a stored column, not `principal - paid`: the settlement and
    // overshoot tolerances are server-internal and never on the wire, so a
    // subtraction here can disagree with the API by a cent. This fixture is
    // deliberately inconsistent — 223.75 - 56 is 167.75, and the server says 12.
    render(<DebtTable {...props} rows={[debt({ remaining: 12 })]} />);

    expect(screen.getByText("USD 12.00")).toBeInTheDocument();
    expect(screen.queryByText("USD 167.75")).not.toBeInTheDocument();
    // A Debt carries no currency field at all, so the code comes from
    // `useOrganization()` — never hardcoded, and never a symbol.
    expect(screen.getByText("USD 223.75")).toBeInTheDocument();
  });

  it("offers no sortable column, because the API has no sort parameter", () => {
    // Ordering is a side effect of the status filter — `{ dueDate: 1 }` for open
    // and overdue, `{ createdAt: -1 }` for the other four — so a fixed "Due
    // date" indicator would be wrong on four of the six tabs, and sorting the 25
    // rows in memory would reorder one page of N and lie about the rest.
    render(<DebtTable {...props} rows={[debt()]} />);

    for (const header of screen.getAllByRole("columnheader")) {
      expect(within(header).queryByRole("button")).toBeNull();
    }
  });

  it("names the source without linking a receipt page from a list row", () => {
    // A debt carries the sale's ObjectId, not its receipt number, so the id is
    // shortened on screen and kept whole in the cell's tooltip.
    render(
      <DebtTable
        {...props}
        rows={[
          debt({
            source: "sale",
            saleId: "68c1f0a4e2b9c7d3a1f4abc123",
            description: undefined,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Sale …abc123")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
