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
    render(<DigestView digest={digest()} currency="ETB" />);
    for (const text of [
      "A steady Saturday",
      "AA batteries 4pk",
      "Amina: 38 sales",
      "Call Hodan Traders",
    ]) {
      // `getAllByText`: a headline legitimately appears more than once now —
      // once in the card's serif paragraph and once in the one-line summary
      // the phone layout collapses that card behind (`hidden` at `lg`, so both
      // are in the DOM at every width). The sales headline also stands in for
      // the advisor's `summary` at the top of the page when the row predates
      // that field. What matters is that each is rendered at all.
      expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
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

  /**
   * The two date assertions that used to live here have moved to
   * `digest-detail.test.tsx` and `insights-screen.test.tsx`, because the day
   * and the window now belong to each screen's own header rather than to this
   * panel — `/insights` prints them above the digest and a second copy inside
   * it would be the same fact twice on one page. **They moved rather than
   * being dropped**: `formatDate` on a bare `yyyy-MM-dd` has shipped three
   * times in this repo and prints the day before for any shop west of
   * Greenwich, so both screens that render one now carry the assertion.
   */

  it("a partial digest names the missing section and why the run stopped", () => {
    render(
      <DigestView
        currency="ETB"
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
      screen.getByText(/team analyst did not finish tonight/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/stopped early \(budget\)/i)).toBeInTheDocument();
  });

  it("gives the REASON the section is missing, not only its name", () => {
    // `errors[]` is typed, sent by the backend with one entry per section
    // that did not submit (spec §7.3), built into this file's own fixture —
    // and was never rendered. The `Missing` card named the section and
    // dropped the reason on the floor.
    render(
      <DigestView
        currency="ETB"
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
    render(
      <DigestView currency="ETB" digest={digest({ status: "partial" })} />,
    );
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
        currency="ETB"
        digest={digest({
          status: "failed",
          stoppedBy: "error",
          sections: noSections(),
          errors: [{ section: "sales", message: "the model returned nothing" }],
        })}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText(/tonight's digest was not written/i),
    ).toBeInTheDocument();
    // The sentence that matters most on this screen: an owner reading
    // "failed" on a page about their sales has every reason to wonder whether
    // the sales are gone.
    expect(screen.getByText(/untouched/i)).toBeInTheDocument();
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
        currency="ETB"
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
        currency="ETB"
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
        currency="ETB"
        digest={digest({
          sections: {
            ...baseDigest.sections,
            sales: { ...baseSales, headline: "<img src=x onerror=alert(1)>" },
          },
        })}
      />,
    );
    // Every place it lands — the serif summary at the top, the card's own
    // paragraph, and the phone layout's one-line summary of that card — is a
    // text node. `getAllByText` matches on textContent, so an element here
    // would have to contain the literal string to be found at all; the
    // `querySelector` is what proves none of them parsed it as markup.
    expect(
      screen.getAllByText("<img src=x onerror=alert(1)>").length,
    ).toBeGreaterThan(0);
    expect(document.querySelector("img")).toBeNull();
  });
});

/**
 * The numeric layer — the point of the rebuild. "Numbers first, prose second,
 * actions biggest" is the canvas's own organising line, and none of it could be
 * drawn until `figures`/`series`/`verdict` landed.
 */
describe("DigestView — the numbers", () => {
  const withAdvisor = (
    recommendations: NonNullable<Digest["sections"]["recommendations"]>,
  ) => digest({ sections: { ...digest().sections, recommendations } });

  it("renders money figures with the currency CODE, never a symbol", () => {
    render(
      <DigestView
        currency="ETB"
        digest={withAdvisor({
          actions: [],
          warnings: [],
          figures: [
            { label: "Revenue", value: 1846.5, unit: "money", tone: "good" },
          ],
        })}
      />,
    );

    expect(screen.getByText("ETB 1,846.50")).toBeInTheDocument();
    expect(screen.queryByText(/\$1,846/)).toBeNull();
  });

  it("colours a figure by the model's tone, not by its label or its sign", () => {
    // "Overdue" rising is bad news and "Overdue" falling is good news. The word
    // cannot tell a component which happened; `tone` is the analyst saying so.
    // Inferring it from the label — or from the sign of `deltaPct`, which is
    // negative here on a GOOD figure — is the mistake this forbids.
    render(
      <DigestView
        currency="ETB"
        digest={withAdvisor({
          actions: [],
          warnings: [],
          figures: [
            {
              label: "Overdue",
              value: 1927.25,
              unit: "money",
              deltaPct: -12.5,
              tone: "good",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("−12.5%")).toHaveClass("text-success-strong");
  });

  it("survives a row written before `figures` existed, which is the only row this shop has", () => {
    // `sections` is a Mongoose `Mixed` field and no migration was run, so the
    // owner's existing digest carries no `figures` key at all — and it is the
    // first thing he will open. No stat row rather than a crash, and no grid of
    // four empty bordered cards either: that would be a claim about his day
    // rather than about the schema.
    const { container } = render(
      <DigestView currency="ETB" digest={digest()} />,
    );

    expect(container.querySelector("[data-slot='stat-card']")).toBeNull();
    expect(screen.getAllByText("A steady Saturday").length).toBeGreaterThan(0);
  });

  it("draws the series oldest-first with the most recent bucket highlighted", () => {
    const base = digest();
    const sales = base.sections.sales;
    if (!sales)
      throw new Error("the default fixture always has a sales section");

    render(
      <DigestView
        currency="ETB"
        digest={digest({
          sections: {
            ...base.sections,
            sales: {
              ...sales,
              figures: [{ label: "Revenue", value: 1846, unit: "money" }],
              series: [
                { label: "TUE", value: 1140 },
                { label: "WED", value: 640 },
                { label: "MON", value: 1846 },
              ],
            },
          },
        })}
      />,
    );

    // Oldest first, left to right, exactly as sent — never reversed and never
    // re-sorted: the labels are the model's own strings, and sorting them as
    // text would put "08 Sep" before "MON" and scramble a week.
    expect(
      screen.getByRole("img", { name: /bar chart/i }),
    ).toHaveAccessibleName("Bar chart. TUE 1140, WED 640, MON 1846");

    const bars = screen.getAllByRole("presentation");
    expect(bars[2]).toHaveClass("bg-chart-1");
    expect(bars[0]).toHaveClass("bg-chart-1/35");
  });
});

describe("DigestView — the verdict is the advisor's or it is not made", () => {
  const withVerdict = (
    verdict: "good" | "mixed" | "poor" | "quiet",
    summary: string,
  ) =>
    digest({
      sections: {
        ...digest().sections,
        recommendations: {
          actions: [],
          warnings: [],
          figures: [],
          verdict,
          summary,
        },
      },
    });

  it("shows the advisor's verdict and its own summary line", () => {
    render(
      <DigestView
        currency="ETB"
        digest={withVerdict("good", "Best Monday in six weeks.")}
      />,
    );

    expect(screen.getByText("Good day")).toBeInTheDocument();
    expect(screen.getByText("Best Monday in six weeks.")).toBeInTheDocument();
  });

  it("keeps a quiet day visually apart from a poor one", () => {
    // "Poor" means the day went badly; "quiet" means there was no day to speak
    // of. A shop that simply did not trade must not be told it did badly, so
    // the two never share a pill colour and quiet carries no status tone.
    const { unmount } = render(
      <DigestView
        currency="ETB"
        digest={withVerdict("quiet", "Little trading today.")}
      />,
    );
    const quiet = screen.getByText("Quiet day");
    expect(quiet).toHaveClass("text-muted-foreground");
    expect(quiet).not.toHaveClass("text-destructive-strong");
    unmount();

    render(
      <DigestView currency="ETB" digest={withVerdict("poor", "A bad day.")} />,
    );
    expect(screen.getByText("Poor day")).toHaveClass("text-destructive-strong");
  });

  it("falls back to the run's status rather than inventing a verdict", () => {
    // The default fixture predates `verdict`. A page that read "A steady
    // Saturday" and put a green "Good day" pill at the top of it would be
    // making up the single largest statement on the screen.
    render(<DigestView currency="ETB" digest={digest()} />);

    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.queryByText(/good day/i)).toBeNull();
  });
});

describe("DigestView — a quiet section is not a failed one", () => {
  const partial = (extra: Partial<Digest>) =>
    digest({
      status: "partial",
      sections: { ...digest().sections, stock: null },
      ...extra,
    });

  it("says nothing moved, and never that the analyst did not finish", () => {
    // A small shop has quiet days constantly. "The stock analyst did not finish
    // tonight" on a day when no stock moved is a lie the owner cannot detect,
    // and it makes a working product look broken every quiet day for ever.
    render(
      <DigestView currency="ETB" digest={partial({ skipped: ["stock"] })} />,
    );

    expect(
      screen.getByText(/no stock moved in this period/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/stock analyst did not finish/i)).toBeNull();
    // "Skipped" is our internal word for it and it sounds like a failure. It
    // must never reach the owner.
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it("counts a quiet analyst as having reported", () => {
    render(
      <DigestView currency="ETB" digest={partial({ skipped: ["stock"] })} />,
    );
    expect(screen.getByText("5 of 5 analysts reported")).toBeInTheDocument();
  });

  it("still says so plainly when the analyst genuinely did not finish", () => {
    render(
      <DigestView
        currency="ETB"
        digest={partial({
          errors: [{ section: "stock", message: "budget spent" }],
        })}
      />,
    );

    expect(
      screen.getByText(/stock analyst did not finish tonight/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/budget spent/)).toBeInTheDocument();
    expect(screen.getByText("4 of 5 analysts reported")).toBeInTheDocument();
  });

  it("keeps a missing section in its own position rather than tidying it away", () => {
    // Hiding it would make a partial run indistinguishable from a complete one
    // with fewer subjects, and the reader would have no way to tell "the
    // shelves are fine" from "nobody looked".
    render(
      <DigestView
        currency="ETB"
        digest={partial({
          errors: [{ section: "stock", message: "budget spent" }],
        })}
      />,
    );

    // Twice by design: the chip in the verdict row that says which analysts
    // reported, and the card standing in the missing section's own position.
    expect(screen.getAllByText("Stock")).toHaveLength(2);
    // A real link to the live page, so the reader is not left with nothing —
    // and a link, not a button dressed as one.
    expect(screen.getByRole("link", { name: /low stock/i })).toHaveAttribute(
      "href",
      "/products?tab=low",
    );
  });
});
