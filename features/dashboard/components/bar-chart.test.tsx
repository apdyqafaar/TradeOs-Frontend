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

describe("BarChart — one highlighted bucket", () => {
  it("keeps every bar at full strength when no bucket is highlighted", () => {
    // The Overview's case, and the behaviour this chart shipped with: there is
    // no "today" on a 30-day trend, so nothing recedes.
    render(
      <BarChart
        series={[10, 20, 40]}
        bucketLabels={["Mon", "Tue", "Wed"]}
        axisLabels={["40", "0"]}
      />,
    );

    for (const bar of screen.getAllByRole("presentation")) {
      expect(bar).toHaveClass("bg-chart-1");
      expect(bar).not.toHaveClass("bg-chart-1/35");
    }
  });

  it("recedes every bar but the highlighted one", () => {
    render(
      <BarChart
        series={[10, 20, 40]}
        bucketLabels={["Mon", "Tue", "Wed"]}
        axisLabels={["40", "0"]}
        highlightIndex={2}
      />,
    );

    const bars = screen.getAllByRole("presentation");
    expect(bars[2]).toHaveClass("bg-chart-1");
    expect(bars[0]).toHaveClass("bg-chart-1/35");
    expect(bars[1]).toHaveClass("bg-chart-1/35");
  });

  it("dims nothing when the index names no bucket, rather than dimming them all", () => {
    // A series that arrived shorter than the caller expected — highlighting
    // bucket 6 of a 3-bucket week — would otherwise recede every bar and
    // emphasise nothing, which reads as a chart that has lost its data.
    render(
      <BarChart
        series={[10, 20, 40]}
        bucketLabels={["Mon", "Tue", "Wed"]}
        axisLabels={["40", "0"]}
        highlightIndex={6}
      />,
    );

    for (const bar of screen.getAllByRole("presentation")) {
      expect(bar).toHaveClass("bg-chart-1");
    }
  });

  it("still names every bucket and value to a screen reader, highlight or not", () => {
    // The highlight is emphasis. Which bucket is which must not depend on it.
    render(
      <BarChart
        series={[10, 40]}
        bucketLabels={["Mon", "Tue"]}
        axisLabels={["40", "0"]}
        highlightIndex={1}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Bar chart. Mon 10, Tue 40" }),
    ).toBeInTheDocument();
  });
});
