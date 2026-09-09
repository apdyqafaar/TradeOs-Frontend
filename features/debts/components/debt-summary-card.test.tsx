import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Debt } from "@/features/debts/types";
import { DebtSummaryCard } from "./debt-summary-card";

/** Artboard `2g`'s figures: 223.75 principal, 56.00 paid, 167.75 remaining. */
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

describe("DebtSummaryCard", () => {
  it("prints every amount with the currency code, never a symbol", () => {
    render(<DebtSummaryCard debt={debt()} currency="USD" />);

    expect(screen.getByText("USD 223.75")).toBeInTheDocument();
    expect(screen.getByText("USD 56.00")).toBeInTheDocument();
    expect(screen.getByText("USD 167.75")).toBeInTheDocument();
    expect(screen.getByText("USD 0.00")).toBeInTheDocument();
  });

  it("shows the server's `remaining`, not `principal - paid`", () => {
    // The two disagree here on purpose. `remaining` is a stored column moved
    // only by guarded atomic updates, and the server's settlement and
    // overshoot tolerances are never on the wire — a card that subtracted
    // would quietly contradict the API by a cent on a screen about money owed.
    render(
      <DebtSummaryCard
        debt={debt({ principal: 100, paid: 40, remaining: 59.99 })}
        currency="USD"
      />,
    );

    expect(screen.getByText("USD 59.99")).toBeInTheDocument();
    expect(screen.queryByText("USD 60.00")).not.toBeInTheDocument();
  });

  it("reads the progress off `paid / principal`, as the canvas draws it", () => {
    render(<DebtSummaryCard debt={debt()} currency="USD" />);
    expect(screen.getByText("25% paid")).toBeInTheDocument();
  });

  it("names the written-off share rather than leaving a bar that just stops", () => {
    // `writtenOffAmount` is the balance at the instant of write-off, not the
    // principal: 4 of 10 paid and then written off is paid 4 / written off 6.
    render(
      <DebtSummaryCard
        debt={debt({
          principal: 10,
          paid: 4,
          remaining: 0,
          writtenOffAmount: 6,
          status: "written_off",
        })}
        currency="KES"
      />,
    );

    expect(screen.getByText("40% paid · 60% written off")).toBeInTheDocument();
  });

  it("survives a zero principal instead of dividing to Infinity", () => {
    render(
      <DebtSummaryCard
        debt={debt({ principal: 0, paid: 0, remaining: 0 })}
        currency="USD"
      />,
    );

    expect(screen.getByText("0% paid")).toBeInTheDocument();
  });
});
