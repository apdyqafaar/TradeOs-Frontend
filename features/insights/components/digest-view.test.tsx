import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

/** All five sections `null` — the shape a failed run actually writes. */
const noSections = (): Digest["sections"] => ({
  sales: null,
  debts: null,
  stock: null,
  team: null,
  recommendations: null,
});

describe("DigestView", () => {
  it("renders five cards from the sections", () => {
    render(<DigestView digest={digest()} />);
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
    // again inside the recommendation that says to call them — so a substring
    // match on "Hodan Traders" legitimately finds two elements. Asserted as
    // exactly two, not "more than none": at `toBeGreaterThan(0)` this passed
    // with one match, and that one match is already covered by the
    // `getByText(/Call Hodan Traders/)` above — so it asserted nothing the
    // file did not already assert, and the debts card dropping
    // `accountsToChase` entirely would have left it green.
    expect(screen.getAllByText(/Hodan Traders/)).toHaveLength(2);
  });

  it("renders the day the digest was generated, in the digest's own timezone", () => {
    // Nothing asserted this date, and swapping `formatDate` for
    // `formatLocalDate` here renders the `—` placeholder (an ISO instant
    // splits on `-` into an unparseable third part) with no test failing.
    // `Africa/Addis_Ababa` is UTC+3 — the exact timezone-immune fixture
    // `docs/FINDINGS.md` §2 names — so the second case below is the one that
    // actually exercises the conversion: 02:06Z on the 13th is still the
    // evening of the 12th in New York, and a digest stamped there must render
    // the day IT was written, not the day the reader happens to be in.
    render(<DigestView digest={digest()} />);
    expect(screen.getByText(/12 Sep 2026/)).toBeInTheDocument();
  });

  it("uses the zone stamped on the digest, not the organization's current one", () => {
    // Each row stores the zone it was written in (`digest.model.ts:32`)
    // precisely so history stays truthful after someone corrects a wrong
    // timezone in Settings. Reading the org's *current* zone made an old
    // row's rendered day disagree with its own `localDate`.
    render(
      <DigestView
        digest={digest({
          localDate: "2026-09-12",
          timezone: "America/New_York",
          generatedAt: "2026-09-13T02:06:00.000Z",
        })}
      />,
    );
    expect(screen.getByText(/12 Sep 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/13 Sep 2026/)).not.toBeInTheDocument();
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
      />,
    );
    expect(
      screen.getByText(/team section could not be written/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/stopped early.*budget/i)).toBeInTheDocument();
  });

  it("gives the REASON the section is missing, not only its name", () => {
    // `errors[]` is typed, sent by the backend with one entry per section
    // that did not submit (spec §7.3), built into this file's own fixture —
    // and was never rendered. The `Missing` card named the section and
    // dropped the reason on the floor.
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
      />,
    );
    expect(
      screen.getByText(/not submitted before the run stopped \(budget\)/i),
    ).toBeInTheDocument();
  });

  it("shows the status on the panel, not only in the history list underneath", () => {
    // Spec §11 requires `status`/`stoppedBy` shown honestly. Only `stoppedBy`
    // was rendered, so the same digest read "Partial" in the list below and
    // carried no label at all in the panel above it.
    render(<DigestView digest={digest({ status: "partial" })} />);
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  it("does not insist four times over that a failed digest is real", () => {
    // Spec §4.2 defines `failed` as "none", and the backend's own fixture for
    // a failed run writes all five sections `null` with `stoppedBy: "error"`
    // (`Backend/tests/integration/ai/dashboard-digest-section.test.ts:26-44`).
    // This used to render "Stopped early (error) — the sections below are
    // what the analysts finished" above five cards each promising that "the
    // rest of this digest is still real". Nothing is real; there is no rest.
    render(
      <DigestView
        digest={digest({
          status: "failed",
          stoppedBy: "error",
          sections: noSections(),
          errors: [{ section: "sales", message: "the model returned nothing" }],
        })}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    expect(screen.queryByText(/is still real/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/the sections below are what the analysts finished/i),
    ).not.toBeInTheDocument();
    // The five reassuring cards are gone with it.
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("What to do tomorrow")).not.toBeInTheDocument();
    // What IS known about why stays on screen.
    expect(screen.getByText(/the model returned nothing/i)).toBeInTheDocument();
  });

  it("says a recommendation's priority in words, not only in its colour", () => {
    // WCAG 1.4.1. The pill's text was `action.kind` and its colour was
    // `action.priority`, so {high, chase, "Call Hodan Traders"} and
    // {low, chase, "Call Juma Kiosk"} announced identically and differed only
    // in hue — on the one card whose entire purpose is ranking tomorrow's
    // work.
    render(
      <DigestView
        digest={digest({
          sections: {
            ...digest().sections,
            recommendations: {
              actions: [
                { priority: "high", kind: "chase", text: "Call Hodan" },
                { priority: "low", kind: "chase", text: "Call Juma" },
              ],
              warnings: [],
            },
          },
        })}
      />,
    );

    const items = screen.getAllByRole("listitem");
    const high = items.find((li) => li.textContent?.includes("Call Hodan"));
    const low = items.find((li) => li.textContent?.includes("Call Juma"));
    expect(high?.textContent).toMatch(/high/i);
    expect(low?.textContent).toMatch(/low/i);
    expect(high?.textContent).not.toMatch(/low/i);
  });

  it("renders two identical actions without colliding their React keys", () => {
    // Nothing in the advisor's prompt stops the model emitting the same
    // action twice, and `key={`${kind}:${text}`}` made that two identical
    // React keys in one `<ol>` — a console error and unstable reconciliation
    // on the next poll tick. `Lines` and `WhyList`, three components earlier
    // in this same file, already carry `biome-ignore` comments arguing
    // exactly this for model-written text.
    //
    // React renders duplicate keys anyway, so counting the rows alone would
    // pass either way: the console is the only place the collision shows.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <DigestView
        digest={digest({
          sections: {
            ...digest().sections,
            recommendations: {
              actions: [
                { priority: "high", kind: "chase", text: "Call Hodan Traders" },
                { priority: "high", kind: "chase", text: "Call Hodan Traders" },
              ],
              warnings: [],
            },
          },
        })}
      />,
    );

    // Two in the recommendations list, plus the one in the debts card.
    expect(screen.getAllByText(/Call Hodan Traders/)).toHaveLength(2);
    expect(screen.getAllByText(/Hodan Traders/)).toHaveLength(3);
    const complaints = errors.mock.calls
      .map((call) => call.join(" "))
      .filter((line) => /same key/i.test(line));
    expect(complaints).toEqual([]);
    errors.mockRestore();
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
      />,
    );
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
