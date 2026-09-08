import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders the label, the value and the footer delta", () => {
    render(
      <StatCard
        label="Today's revenue"
        value="USD 20,320.00"
        delta="+0.94%"
        deltaTone="positive"
        foot="vs last week"
      />,
    );
    expect(screen.getByText("Today's revenue")).toBeInTheDocument();
    expect(screen.getByText("USD 20,320.00")).toBeInTheDocument();
    expect(screen.getByText("+0.94%")).toBeInTheDocument();
  });

  it("omits the footer row entirely when there is no delta or foot text", () => {
    const { container } = render(<StatCard label="Sales today" value="18" />);
    expect(container.querySelector("[data-slot='stat-card-foot']")).toBeNull();
  });
});
