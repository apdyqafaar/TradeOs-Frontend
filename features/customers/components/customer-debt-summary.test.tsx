import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomerDebtSummary } from "./customer-debt-summary";

/**
 * These tests exist to hold one line: `overdue` is a count, and no amount of
 * canvas fidelity may turn it into money. Everything else here is decoration.
 */
describe("CustomerDebtSummary", () => {
  it("shows outstanding as money and overdue as a count of debts", () => {
    // The canvas draws "Overdue USD 0.00", but the API returns a COUNT here,
    // not an amount (Backend/src/db/actions/debt.actions.ts:197). Printing a
    // count with a currency code would be a fabricated number.
    render(
      <CustomerDebtSummary
        summary={{ open: 3, overdue: 1, totalRemaining: 76.5 }}
        currency="USD"
      />,
    );

    expect(screen.getByText("USD 76.50")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.queryByText("USD 1.00")).not.toBeInTheDocument();
  });

  it("says a customer owes nothing rather than showing zeroes", () => {
    render(
      <CustomerDebtSummary
        summary={{ open: 0, overdue: 0, totalRemaining: 0 }}
        currency="USD"
      />,
    );
    expect(screen.getByText(/nothing outstanding/i)).toBeInTheDocument();
  });

  it("keeps the currency code off the overdue slot when money is owed but nothing is late", () => {
    /*
     * The case the canvas actually drew — 76.50 outstanding, nothing overdue —
     * and the one where the mistake is easiest to make, because "USD 0.00"
     * looks so plausible sitting beside a real amount.
     */
    render(
      <CustomerDebtSummary
        summary={{ open: 2, overdue: 0, totalRemaining: 40 }}
        currency="USD"
      />,
    );

    expect(screen.getByText("USD 40.00")).toBeInTheDocument();
    expect(screen.getByText("None overdue")).toBeInTheDocument();
    expect(screen.queryByText("USD 0.00")).not.toBeInTheDocument();
  });

  it("says how many debts the outstanding total is spread across", () => {
    // `open` is the other count, and it is what makes `totalRemaining` mean
    // something: one debt of 76.50 and nine of 7.65 are different problems.
    render(
      <CustomerDebtSummary
        summary={{ open: 1, overdue: 0, totalRemaining: 12 }}
        currency="KES"
      />,
    );
    expect(screen.getByText("across 1 open debt")).toBeInTheDocument();
  });
});
