import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolTrace } from "@/features/insights/types";
import { TraceView } from "./trace-view";

const call = (overrides: Partial<ToolTrace> = {}): ToolTrace => ({
  seq: 1,
  agent: "Sales analyst",
  tool: "getDailySales",
  input: { date: "2026-09-12" },
  summary: "Read yesterday's sales",
  output: { total: 12 },
  ms: 420,
  ...overrides,
});

describe("TraceView", () => {
  it("renders each row's agent, tool and summary, in the order given", () => {
    render(
      <TraceView
        trace={[
          call({
            seq: 1,
            agent: "Sales analyst",
            tool: "getDailySales",
            summary: "Read yesterday's sales",
          }),
          call({
            seq: 2,
            agent: "Stock analyst",
            tool: "getLowStock",
            summary: "Checked low stock",
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Sales analyst");
    expect(rows[0]).toHaveTextContent("getDailySales");
    expect(rows[0]).toHaveTextContent("Read yesterday's sales");
    expect(rows[1]).toHaveTextContent("Stock analyst");
    expect(rows[1]).toHaveTextContent("getLowStock");
    expect(rows[1]).toHaveTextContent("Checked low stock");
  });

  it("renders a tool's output as text, never as markup — a product named like a tag is just a string", () => {
    render(<TraceView trace={[call({ output: "<b>bold</b>" })]} />);

    expect(screen.getByText(/<b>bold<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows a quiet message when no tool calls were recorded", () => {
    render(<TraceView trace={[]} />);
    expect(
      screen.getByText(/no tool calls were recorded for this digest/i),
    ).toBeInTheDocument();
  });
});

describe("TraceView — each row's disclosure names its own tool", () => {
  it("gives every summary a distinct accessible name", () => {
    // Spec §7.4 caps a trace at 30 hops, and every one of them used to read
    // "Parameters and result": thirty identically-named expandable controls
    // in a row, with the agent/tool/summary sitting in a sibling <div> that
    // is not part of the control's name.
    render(
      <TraceView
        trace={[
          call({ seq: 1, tool: "getDailySales" }),
          call({ seq: 2, tool: "getLowStock" }),
        ]}
      />,
    );

    const names = screen
      .getAllByText(/parameters and result/i)
      .map((node) => node.textContent);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toMatch(/getDailySales/);
    expect(names[1]).toMatch(/getLowStock/);
  });
});
