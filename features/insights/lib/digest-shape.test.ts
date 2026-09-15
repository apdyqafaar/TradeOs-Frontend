import { describe, expect, it } from "vitest";
import {
  ANALYST_COUNT,
  actionsSummary,
  analystsReported,
  headlineOf,
  heroFigures,
  readSectionState,
  sectionStates,
  summaryOf,
  verdictOf,
} from "@/features/insights/lib/digest-shape";
import type {
  Digest,
  DigestSections,
  RecommendationsSection,
  SalesSection,
} from "@/features/insights/types";

const sales = (partial: Partial<SalesSection> = {}): SalesSection => ({
  headline: "Best Monday in six weeks",
  points: [],
  comparison: { vsLastWeek: "", monthToDate: "" },
  anomalies: [],
  ...partial,
});

const advice = (
  partial: Partial<RecommendationsSection> = {},
): RecommendationsSection => ({ actions: [], warnings: [], ...partial });

const sections = (partial: Partial<DigestSections> = {}): DigestSections => ({
  sales: null,
  debts: null,
  stock: null,
  team: null,
  recommendations: null,
  ...partial,
});

const digest = (partial: Partial<Digest> = {}): Digest => ({
  id: "d1",
  localDate: "2026-09-14",
  timezone: "Africa/Mogadishu",
  language: "en",
  model: "m",
  trigger: "cron",
  status: "complete",
  stoppedBy: "complete",
  sections: sections(),
  errors: [],
  trace: [],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
    routerCalls: 0,
    costUsd: 0,
  },
  generatedAt: "2026-09-14T18:02:00.000Z",
  createdAt: "2026-09-14T18:02:00.000Z",
  ...partial,
});

describe("a section has three states, not two", () => {
  it("is delivered when the analyst wrote it", () => {
    expect(
      readSectionState(
        digest({ sections: sections({ sales: sales() }) }),
        "sales",
      ),
    ).toEqual({ kind: "delivered" });
  });

  it("is failed — with the backend's own reason — when it is absent and not quiet", () => {
    expect(
      readSectionState(
        digest({
          errors: [
            {
              section: "stock",
              message: "not submitted before the run stopped",
            },
          ],
        }),
        "stock",
      ),
    ).toEqual({
      kind: "failed",
      reason: "not submitted before the run stopped",
    });
  });

  it("is quiet — never 'did not finish' — when the analyst was never dispatched", () => {
    // A small shop has quiet days constantly. "The stock analyst did not
    // finish tonight" printed on a day when no stock moved is a lie the owner
    // cannot detect, and it makes a working product look broken every quiet
    // day for ever.
    expect(readSectionState(digest({ skipped: ["stock"] }), "stock")).toEqual({
      kind: "quiet",
    });
  });

  it("prefers the content it actually has over any other field", () => {
    // A row both present and listed as quiet is a backend inconsistency.
    // Rendering the section we were sent is the honest resolution of it.
    expect(
      readSectionState(
        digest({ sections: sections({ sales: sales() }), skipped: ["sales"] }),
        "sales",
      ),
    ).toEqual({ kind: "delivered" });
  });
});

describe("analystsReported", () => {
  it("counts the advisor as one of the five", () => {
    // The network runs four analysts plus an advisor (`AGENT_NAMES` in
    // Backend/src/services/ai/schemas.ts). Counting only the four analysts
    // would print "4 of 4" on a complete run and "3 of 4" on one where only
    // the advisor was lost — which is the run where the reader most needs to
    // know the to-do list is missing.
    expect(ANALYST_COUNT).toBe(5);
    expect(
      analystsReported(
        digest({
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            stock: { headline: "", points: [], reorder: [] },
            team: { headline: "", people: [], projects: [] },
            recommendations: advice(),
          }),
        }),
      ),
    ).toBe(5);
  });

  it("counts a QUIET analyst as having reported — a quiet day is not a shortfall", () => {
    // The answer to "what happened in stock today?" was "nothing", and that is
    // a complete report. Counting it as a shortfall would put "4 of 5 analysts
    // reported" at the top of an ordinary quiet Sunday.
    expect(
      analystsReported(
        digest({
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            team: { headline: "", people: [], projects: [] },
            recommendations: advice(),
          }),
          skipped: ["stock"],
        }),
      ),
    ).toBe(5);
  });

  it("counts what arrived on a partial run, and does not round it up", () => {
    expect(
      analystsReported(
        digest({
          sections: sections({
            sales: sales(),
            debts: null,
            recommendations: advice(),
          }),
        }),
      ),
    ).toBe(2);
  });

  it("is 0 on a failed run rather than undefined", () => {
    expect(analystsReported(digest())).toBe(0);
  });
});

describe("sectionStates", () => {
  it("lists all five in reading order, each with its own three-way state", () => {
    // The partial artboard's row of chips. A section that did not finish stays
    // ON the list rather than disappearing from it: dropping it would make a
    // partial run look like a complete one with fewer subjects.
    const chips = sectionStates(
      digest({
        sections: sections({ sales: sales(), recommendations: advice() }),
        skipped: ["stock"],
      }),
    );

    expect(chips.map((chip) => chip.key)).toEqual([
      "sales",
      "debts",
      "stock",
      "team",
      "recommendations",
    ]);
    expect(chips.map((chip) => chip.state.kind)).toEqual([
      "delivered",
      "failed",
      "quiet",
      "failed",
      "delivered",
    ]);
  });
});

describe("heroFigures", () => {
  it("prefers the advisor's own four — it is the one agent that saw all four reports", () => {
    const picked = heroFigures(
      sections({
        sales: sales({
          figures: [{ label: "Revenue", value: 1, unit: "money" }],
        }),
        recommendations: advice({
          figures: [
            { label: "Revenue", value: 1846.5, unit: "money" },
            { label: "Gross profit", value: 512.2, unit: "money" },
          ],
          series: [{ label: "MON", value: 1846.5 }],
        }),
      }),
    );

    expect(picked.map((hero) => hero.figure.label)).toEqual([
      "Revenue",
      "Gross profit",
    ]);
    expect(picked[0]?.figure.value).toBe(1846.5);
    expect(picked[0]?.series).toEqual([{ label: "MON", value: 1846.5 }]);
  });

  it("takes one figure per analyst when the advisor wrote none, not four from the loudest", () => {
    const picked = heroFigures(
      sections({
        sales: sales({
          figures: [
            { label: "Revenue", value: 1846.5, unit: "money" },
            { label: "Average sale", value: 49.9, unit: "money" },
            { label: "Receipts", value: 37, unit: "count" },
          ],
        }),
        debts: {
          headline: "",
          points: [],
          accountsToChase: [],
          figures: [{ label: "Overdue", value: 1927.25, unit: "money" }],
        },
      }),
    );

    expect(picked.map((hero) => hero.figure.label)).toEqual([
      "Revenue",
      "Overdue",
    ]);
  });

  it("never returns more than four, whatever the model sent", () => {
    expect(
      heroFigures(
        sections({
          recommendations: advice({
            figures: Array.from({ length: 6 }, (_, index) => ({
              label: `f${index}`,
              value: index,
              unit: "count" as const,
            })),
          }),
        }),
      ),
    ).toHaveLength(4);
  });

  it("is empty — not four blank cards — while no section carries figures", () => {
    // The live answer as of 2026-09-15: the API's section schemas are prose
    // only. Four empty bordered cards would be a claim about the shop's day
    // rather than about the schema.
    expect(heroFigures(sections({ sales: sales() }))).toEqual([]);
  });
});

describe("the verdict is never inferred", () => {
  it("returns what the advisor wrote", () => {
    expect(
      verdictOf(
        digest({
          sections: sections({ recommendations: advice({ verdict: "poor" }) }),
        }),
      ),
    ).toBe("poor");
  });

  it("is null when the advisor did not write one, even with a glowing headline", () => {
    // The bug this forbids: reading "Best Monday in six weeks" and putting a
    // green "Good day" pill at the top of the page. The advisor makes that
    // judgement; a heuristic here would be the screen inventing the single
    // largest statement on it.
    expect(
      verdictOf(digest({ sections: sections({ sales: sales() }) })),
    ).toBeNull();
  });
});

describe("summaryOf", () => {
  it("uses the advisor's whole-day summary when there is one", () => {
    expect(
      summaryOf(
        digest({
          sections: sections({
            sales: sales(),
            recommendations: advice({
              summary: "Two accounts slipped past due.",
            }),
          }),
        }),
      ),
    ).toBe("Two accounts slipped past due.");
  });

  it("falls back to the first headline an analyst actually wrote", () => {
    expect(summaryOf(digest({ sections: sections({ sales: sales() }) }))).toBe(
      "Best Monday in six weeks",
    );
  });

  it("is null when nothing at all was written", () => {
    expect(summaryOf(digest())).toBeNull();
    expect(headlineOf(digest())).toBeNull();
  });
});

describe("actionsSummary", () => {
  it("counts the actions and the high ones", () => {
    expect(
      actionsSummary(
        digest({
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            stock: { headline: "", points: [], reorder: [] },
            team: { headline: "", people: [], projects: [] },
            recommendations: advice({
              actions: [
                { priority: "high", kind: "chase", text: "a" },
                { priority: "high", kind: "restock", text: "b" },
                { priority: "low", kind: "promote", text: "c" },
              ],
            }),
          }),
        }),
      ),
    ).toBe("3 actions · 2 high");
  });

  it("says which analysts were missing, so a short list is not read as good news", () => {
    // An advisor can only recommend restocking if the stock analyst reported.
    // A list with no restock on it otherwise means either "the shelves are
    // fine" or "nobody looked", and the reader cannot tell which.
    expect(
      actionsSummary(
        digest({
          status: "partial",
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            recommendations: advice({
              actions: [
                { priority: "high", kind: "chase", text: "a" },
                { priority: "high", kind: "chase", text: "b" },
                { priority: "medium", kind: "review", text: "c" },
                { priority: "low", kind: "review", text: "d" },
              ],
            }),
          }),
        }),
      ),
    ).toBe("4 actions · 2 high · no stock or team actions tonight");
  });

  it("singularises one action", () => {
    expect(
      actionsSummary(
        digest({
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            stock: { headline: "", points: [], reorder: [] },
            team: { headline: "", people: [], projects: [] },
            recommendations: advice({
              actions: [{ priority: "low", kind: "other", text: "a" }],
            }),
          }),
        }),
      ),
    ).toBe("1 action · 0 high");
  });
});

describe("actionsSummary — the tail names failures, never quiet subjects", () => {
  it("leaves a quiet analyst out of the tail", () => {
    // Nothing went wrong and nothing was missed: there was no stock movement
    // to act on. "No stock actions tonight" would be true and would still read
    // as the shortfall it is not.
    expect(
      actionsSummary(
        digest({
          sections: sections({
            sales: sales(),
            debts: { headline: "", points: [], accountsToChase: [] },
            team: { headline: "", people: [], projects: [] },
            recommendations: advice({
              actions: [{ priority: "high", kind: "chase", text: "a" }],
            }),
          }),
          skipped: ["stock"],
        }),
      ),
    ).toBe("1 action · 1 high");
  });
});

describe("the three ways a section can carry no numbers", () => {
  const withFigures = (figures: SalesSection["figures"]) =>
    sections({ sales: sales({ figures }) });

  it("survives `figures: []` — a required field that is legitimately empty", () => {
    // "Nothing in it" is a real answer on a quiet day, not missing data.
    expect(heroFigures(withFigures([]))).toEqual([]);
  });

  it("survives `figures` absent entirely, which is EVERY row written before 2026-09-15", () => {
    // `sections` is a Mongoose `Mixed` field and no migration was run, so the
    // only digest this shop actually has carries no `figures` key at all — and
    // it is therefore the first row its owner will open. A stat row that
    // assumed four figures would crash on exactly that one.
    expect(heroFigures(withFigures(undefined))).toEqual([]);
  });

  it("falls through an empty advisor to the analysts, rather than stopping at it", () => {
    // `figures: []` on the advisor is not "the advisor spoke"; it is "the
    // advisor had nothing to pick". Treating it as an answer would blank a
    // page whose analysts each had a number.
    const picked = heroFigures(
      sections({
        sales: sales({
          figures: [{ label: "Revenue", value: 1846.5, unit: "money" }],
        }),
        recommendations: advice({ figures: [] }),
      }),
    );
    expect(picked.map((hero) => hero.figure.label)).toEqual(["Revenue"]);
  });

  it("carries a series through untouched — oldest first, never re-sorted", () => {
    // The labels are the model's own short axis strings. Sorting them as text
    // would put "08 Sep" before "MON" and scramble a week.
    const series = [
      { label: "TUE", value: 1140 },
      { label: "WED", value: 640 },
      { label: "MON", value: 1846 },
    ];
    const picked = heroFigures(
      sections({
        sales: sales({
          figures: [{ label: "Revenue", value: 1846, unit: "money" }],
          series,
        }),
      }),
    );
    expect(picked[0]?.series).toEqual(series);
  });
});
