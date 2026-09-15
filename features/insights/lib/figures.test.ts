import { describe, expect, it } from "vitest";
import {
  directionWord,
  figureDeltaClass,
  figureValueClass,
  formatDeltaPct,
  formatFigureValue,
  seriesLabels,
  seriesSummary,
  seriesValues,
  statDeltaTone,
} from "@/features/insights/lib/figures";
import type { SectionFigure } from "@/features/insights/types";

const figure = (partial: Partial<SectionFigure>): SectionFigure => ({
  label: "Revenue",
  value: 0,
  unit: "count",
  ...partial,
});

describe("formatFigureValue", () => {
  it("prints money with the currency CODE and never a symbol", () => {
    // This market mixes currencies whose symbols collide — $ is USD, CAD and a
    // dozen others; Sh is KES, TZS and UGX. A receipt or a digest that shows
    // the wrong one is a dispute, so the code is the only acceptable label.
    const rendered = formatFigureValue(
      figure({ value: 1846.5, unit: "money" }),
      "USD",
    );

    expect(rendered).toBe("USD 1,846.50");
    expect(rendered).not.toMatch(/[$£€¥]/);
  });

  it("renders a bare number rather than an unlabelled amount while the currency is unknown", () => {
    // `useCurrencyConfig()` reports `""` until `/organizations/current/currency`
    // answers. `formatMoney` then produces a leading space; printing that raw
    // puts a floating " 1,846.50" on the page, and inventing "USD" would be a
    // wrong label rather than a missing one.
    expect(
      formatFigureValue(figure({ value: 1846.5, unit: "money" }), ""),
    ).toBe("1,846.50");
  });

  it("treats a percent figure as percentage POINTS, not as a fraction", () => {
    // The opposite convention is live one screen away: `marginPct` and `share`
    // on the reports payloads are 0..1 fractions despite their names, and
    // rendering one raw printed "0.38%" over a healthy margin. Whichever way
    // the digest schema settles, it is decided in exactly one place and this
    // test is what names it.
    expect(formatFigureValue(figure({ value: 27.7, unit: "percent" }))).toBe(
      "27.7%",
    );
    // The bug this forbids: 0.94 silently re-read as 94%.
    expect(formatFigureValue(figure({ value: 0.94, unit: "percent" }))).toBe(
      "0.9%",
    );
  });

  it("singularises days, so a one-day cover does not read '1 days'", () => {
    expect(formatFigureValue(figure({ value: 4, unit: "days" }))).toBe(
      "4 days",
    );
    expect(formatFigureValue(figure({ value: 1, unit: "days" }))).toBe("1 day");
  });

  it("groups a count and keeps it free of decimals it does not have", () => {
    expect(formatFigureValue(figure({ value: 1237, unit: "count" }))).toBe(
      "1,237",
    );
  });

  it("renders 0 rather than NaN when the model sends something unusable", () => {
    expect(
      formatFigureValue(figure({ value: Number.NaN, unit: "money" }), "ETB"),
    ).toBe("ETB 0.00");
  });
});

describe("formatDeltaPct", () => {
  it("signs a rise and a fall, using a real minus sign", () => {
    expect(formatDeltaPct(21.4)).toBe("+21.4%");
    // U+2212, as the canvas draws it: a hyphen beside tabular mono figures
    // reads as a dash rather than as a sign.
    expect(formatDeltaPct(-54.3)).toBe("−54.3%");
  });

  it("is null when there is no comparison, so nothing claims one was made", () => {
    expect(formatDeltaPct(undefined)).toBeNull();
    expect(formatDeltaPct(Number.NaN)).toBeNull();
  });

  it("prints an exact zero without a sign", () => {
    expect(formatDeltaPct(0)).toBe("0.0%");
  });
});

describe("tone comes from the model, never from the label", () => {
  it("colours a figure the model called bad as bad, whatever its label says", () => {
    // "Overdue" rising is bad news and "Overdue" falling is good news; the word
    // cannot tell a component which happened, which is what `tone` is for.
    expect(figureValueClass(figure({ label: "Overdue", tone: "bad" }))).toBe(
      "text-destructive-strong",
    );
    expect(figureValueClass(figure({ label: "Overdue", tone: "good" }))).toBe(
      "text-success-strong",
    );
  });

  it("treats an absent tone as neutral — unknown is not good news", () => {
    expect(figureValueClass(figure({ label: "Collected" }))).toBe(
      "text-foreground",
    );
    expect(figureDeltaClass(figure({ label: "Collected" }))).toBe(
      "text-muted-foreground",
    );
  });

  it("keeps a caution a caution when narrowing to StatCard's tones", () => {
    // `warn` → `neutral` would be the one mapping that loses information: the
    // digest exists to say a figure can be neither good nor catastrophic.
    expect(statDeltaTone(figure({ tone: "warn" }))).toBe("caution");
    expect(statDeltaTone(figure({ tone: "good" }))).toBe("positive");
    expect(statDeltaTone(figure({ tone: "bad" }))).toBe("negative");
    expect(statDeltaTone(figure({}))).toBe("neutral");
  });
});

describe("direction is a word, not a glyph", () => {
  it("names up and down", () => {
    expect(directionWord("up")).toBe("up");
    expect(directionWord("down")).toBe("down");
  });

  it("says nothing for flat or absent, rather than repeating a 0.0% delta", () => {
    expect(directionWord("flat")).toBeNull();
    expect(directionWord(undefined)).toBeNull();
  });
});

describe("series", () => {
  it("is undefined rather than empty when there is nothing to draw", () => {
    // `StatCard` and `BarChart` both render an empty array as an empty gutter
    // with borders and no bars, which looks like a broken chart.
    expect(seriesValues(undefined)).toBeUndefined();
    expect(seriesValues([])).toBeUndefined();
  });

  it("keeps order and pairs values with their labels", () => {
    const series = [
      { label: "SAT", value: 1760 },
      { label: "SUN", value: 1450 },
      { label: "MON", value: 1846 },
    ];
    expect(seriesValues(series)).toEqual([1760, 1450, 1846]);
    expect(seriesLabels(series)).toEqual(["SAT", "SUN", "MON"]);
  });

  it("substitutes 0 for a value that is not a number, so no bar gets height: NaN%", () => {
    expect(
      seriesValues([{ label: "MON", value: Number.POSITIVE_INFINITY }]),
    ).toEqual([0]);
  });

  it("describes itself with the caller's own formatter, so the spoken chart carries the currency", () => {
    expect(
      seriesSummary([{ label: "MON", value: 1846.5 }], (value) =>
        formatFigureValue({ label: "", value, unit: "money" }, "USD"),
      ),
    ).toBe("MON USD 1,846.50");
  });
});
