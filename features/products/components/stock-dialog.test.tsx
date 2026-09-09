import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { StockDialog } from "./stock-dialog";

const mutate = vi.fn();
vi.mock("@/features/products/hooks/use-stock-mutation", () => ({
  useStockMutation: () => ({ mutate, isPending: false, error: null }),
}));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

const open = {
  open: true,
  onOpenChange: vi.fn(),
  productId: "p1",
  unit: "pcs",
  quantity: 48,
};

describe("StockDialog", () => {
  it("previews the resulting quantity before anything is sent", async () => {
    // The canvas shows a "New quantity" line. Stock is the number a shop
    // trusts; showing the outcome first is how a typo gets caught.
    render(wrap(<StockDialog {...open} type="restock" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "12");
    expect(screen.getByText("60 pcs")).toBeInTheDocument();
  });

  it("requires a reason for an adjustment", async () => {
    render(wrap(<StockDialog {...open} type="adjustment" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "-3");
    await userEvent.click(screen.getByRole("button", { name: /adjust/i }));

    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("will not let an adjustment drive stock below zero", async () => {
    // The API refuses this with 409 INSUFFICIENT_STOCK; catching it here means
    // the user sees why while they are still looking at the number.
    render(wrap(<StockDialog {...open} type="adjustment" />));
    await userEvent.type(screen.getByLabelText(/quantity/i), "-100");
    expect(
      await screen.findByText(/only 48 pcs in stock/i),
    ).toBeInTheDocument();
  });
});
