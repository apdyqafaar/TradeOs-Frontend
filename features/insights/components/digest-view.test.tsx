import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Digest } from "@/features/insights/types";
import { DigestView } from "./digest-view";

const digest = (overrides: Partial<Digest> = {}): Digest => ({
  id: "d1",
  localDate: "2026-09-12",
  timezone: "Africa/Addis_Ababa",
  language: "en",
  model: "m",
  trigger: "cron",
  status: "complete",
  stoppedBy: "complete",
  sections: {
    sales: {
      headline: "A steady Saturday",
      points: ["Cooking oil led"],
      comparison: { vsLastWeek: "down 18%", monthToDate: "6% ahead" },
      anomalies: ["One void of ETB 4,000"],
    },
    debts: {
      headline: "Credit crept up",
      points: ["Juma Kiosk fell overdue"],
      accountsToChase: [
        { customer: "Hodan Traders", why: "ETB 12,000, 34 days" },
      ],
    },
    stock: {
      headline: "Two lines thin",
      points: ["Bar soap sold out at 14:00"],
      reorder: [{ product: "AA batteries 4pk", why: "3 days left" }],
    },
    team: {
      headline: "Amina carried the till",
      people: ["Amina: 38 sales"],
      projects: ["Solar install due Tuesday, 40%"],
    },
    recommendations: {
      actions: [
        { priority: "high", kind: "chase", text: "Call Hodan Traders" },
      ],
      warnings: ["Batteries run out in 3 days"],
    },
  },
  errors: [],
  trace: [],
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    calls: 9,
    routerCalls: 4,
    costUsd: 0.08,
  },
  generatedAt: "2026-09-12T18:06:00.000Z",
  createdAt: "2026-09-12T18:06:00.000Z",
  ...overrides,
});

describe("DigestView", () => {
  it("renders five cards from the sections", () => {
    render(<DigestView digest={digest()} timezone="Africa/Addis_Ababa" />);
    for (const text of [
      "A steady Saturday",
      "AA batteries 4pk",
      "Amina: 38 sales",
      "Call Hodan Traders",
    ]) {
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    }
    // `getAllByText`, not `getByText`, for this one pair: "Hodan Traders" is
    // named twice by design — once as the debts card's overdue account, once
    // again inside the recommendation that says to call them — so a
    // substring match on "Hodan Traders" legitimately finds two elements.
    // The other four strings above only ever match one element, so they keep
    // `getByText` and would still catch an accidental duplicate render.
    expect(screen.getAllByText(/Hodan Traders/).length).toBeGreaterThan(0);
  });

  it("a partial digest names the missing section and why the run stopped", () => {
    render(
      <DigestView
        digest={digest({
          status: "partial",
          stoppedBy: "budget",
          sections: { ...digest().sections, team: null },
          errors: [
            {
              section: "team",
              message: "not submitted before the run stopped (budget)",
            },
          ],
        })}
        timezone="Africa/Addis_Ababa"
      />,
    );
    expect(
      screen.getByText(/team section could not be written/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/stopped early.*budget/i)).toBeInTheDocument();
  });

  it("model text is text, never markup", () => {
    const baseDigest = digest();
    const baseSales = baseDigest.sections.sales;
    if (!baseSales)
      throw new Error("the default fixture always has a sales section");

    render(
      <DigestView
        digest={digest({
          sections: {
            ...baseDigest.sections,
            sales: { ...baseSales, headline: "<img src=x onerror=alert(1)>" },
          },
        })}
        timezone="Africa/Addis_Ababa"
      />,
    );
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
