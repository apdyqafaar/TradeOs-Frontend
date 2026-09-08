import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart";

describe("BarChart", () => {
  it("scales every bar against the largest value", () => {
    render(
      <BarChart
        series={[10, 20, 40]}
        bucketLabels={["Mon", "Tue", "Wed"]}
        axisLabels={["40", "20", "0"]}
      />,
    );
    const bars = screen.getAllByRole("presentation");
    expect(bars[2]).toHaveStyle({ height: "100%" });
    expect(bars[1]).toHaveStyle({ height: "50%" });
  });

  it("renders a flat baseline rather than dividing by zero when every value is 0", () => {
    render(
      <BarChart
        series={[0, 0]}
        bucketLabels={["Mon", "Tue"]}
        axisLabels={["0"]}
      />,
    );
    for (const bar of screen.getAllByRole("presentation")) {
      expect(bar).toHaveStyle({ height: "0%" });
    }
  });
});
