import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockBadge } from "./stock-badge";

describe("StockBadge", () => {
  it("says Untracked for a service, rather than showing a quantity of zero", () => {
    // trackStock: false means a service or a fee. Zero would read as "sold out".
    render(<StockBadge trackStock={false} quantity={0} unit="pcs" />);
    expect(screen.getByText("Untracked")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("distinguishes out of stock from low stock", () => {
    const { rerender } = render(
      <StockBadge trackStock quantity={0} unit="pcs" lowStockThreshold={10} />,
    );
    expect(screen.getByText("Out")).toBeInTheDocument();

    rerender(
      <StockBadge trackStock quantity={4} unit="pcs" lowStockThreshold={10} />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("is quiet when stock is healthy, and shows the quantity with its unit", () => {
    render(
      <StockBadge trackStock quantity={48} unit="kg" lowStockThreshold={10} />,
    );
    expect(screen.getByText("48 kg")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("has no threshold to compare against, so it only reports the quantity", () => {
    render(<StockBadge trackStock quantity={2} unit="pcs" />);
    expect(screen.getByText("2 pcs")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });
});
