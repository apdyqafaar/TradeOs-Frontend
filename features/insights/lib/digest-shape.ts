import type {
  Digest,
  DigestSections,
  DigestSummary,
  DigestVerdict,
  SectionFigure,
  SectionKey,
  SeriesPoint,
} from "@/features/insights/types";

/**
 * Reading a `Digest` into the shape the screen draws — counting what arrived,
 * choosing the four numbers that go at the top, and deciding what the page
 * says when the advisor's own verdict is not on the wire.
 *
 * Separate from the components because every one of these is a judgement with
 * a wrong answer that renders perfectly: counting four analysts as five,
 * hiding a section that did not run, or inventing a "Good day" nobody wrote.
 */

/**
 * The five, in reading order. **`recommendations` is one of them** — the
 * advisor is an analyst like the other four, and "5 of 5 analysts reported"
 * counts it. Four analysts plus an advisor is what the network actually runs
 * (`Backend/src/services/ai/schemas.ts`, `AGENT_NAMES`).
 */
export const SECTION_ORDER = [
  "sales",
  "debts",
  "stock",
  "team",
  "recommendations",
] as const satisfies readonly SectionKey[];

/** Five. Named rather than written as a literal beside "of". */
export const ANALYST_COUNT = SECTION_ORDER.length;

export const SECTION_LABELS: Record<SectionKey, string> = {
  sales: "Sales",
  debts: "Debts",
  stock: "Stock",
  team: "Team & projects",
  recommendations: "What to do tomorrow",
};

/** The same five, shortened for the row of chips on a partial run. */
export const SECTION_CHIP_LABELS: Record<SectionKey, string> = {
  sales: "Sales",
  debts: "Debts",
  stock: "Stock",
  team: "Team",
  recommendations: "Tomorrow",
};

/**
 * How many of the five wrote something.
 *
 * **Not a backend field.** Nothing on the wire counts this; it is the count of
 * non-null sections and it is computed here, which is why it is one exported
 * function rather than an inline `Object.values(...).filter(Boolean).length`
 * in whichever component needed it first. A run that stopped on budget after
 * three submissions and a run that lost two analysts to parse errors are the
 * same "3 of 5" to a reader, and both are honest.
 */
export function analystsReported(sections: DigestSections): number {
  return SECTION_ORDER.filter((key) => sections[key] !== null).length;
}

/** Which of the five arrived, in reading order — the chips on a partial run. */
export function sectionPresence(
  sections: DigestSections,
): { key: SectionKey; label: string; present: boolean }[] {
  return SECTION_ORDER.map((key) => ({
    key,
    label: SECTION_CHIP_LABELS[key],
    present: sections[key] !== null,
  }));
}

/** One number for the top of the page, and the series it was drawn from. */
export interface HeroFigure {
  key: string;
  figure: SectionFigure;
  /** The owning section's series, so the sparkline is of the same thing. */
  series?: SeriesPoint[];
}

/**
 * The four numbers that land before any prose.
 *
 * The advisor's own `figures` win when it wrote any — it is the one agent that
 * saw all four reports and is therefore the only one that can say which four
 * numbers describe the *day*. Failing that, the first figure from each analyst
 * in reading order, which gives one number per subject rather than four
 * revenue variants from whichever analyst happened to be verbose.
 *
 * **Returns `[]` when no section carries figures**, which is the live answer
 * as of 2026-09-15 — `Backend/src/services/ai/schemas.ts` still describes the
 * sections as prose only. The caller renders no stat row at all rather than
 * four empty cards; an empty grid of borders says "we have nothing", which is
 * a claim about the shop rather than about the schema.
 */
export function heroFigures(sections: DigestSections): HeroFigure[] {
  const advisor = sections.recommendations;
  if (advisor?.figures && advisor.figures.length > 0) {
    return advisor.figures.slice(0, 4).map((figure, index) => ({
      key: `recommendations-${index}`,
      figure,
      series: advisor.series,
    }));
  }

  const picked: HeroFigure[] = [];
  for (const key of ["sales", "debts", "stock", "team"] as const) {
    const section = sections[key];
    const first = section?.figures?.[0];
    if (section && first) {
      picked.push({ key: `${key}-0`, figure: first, series: section.series });
    }
  }
  return picked.slice(0, 4);
}

/**
 * The advisor's one-word reading of the day, or `null`.
 *
 * **Never inferred.** There is no rule here that turns "revenue was up" into
 * "Good day": a verdict is a judgement, the advisor is the thing that makes
 * it, and a page that derives one from whichever figures it happens to have is
 * making up the single largest statement on the screen. When this is `null`
 * the screen shows the run's `status` pill instead — Complete, Partial, Failed
 * — which is a fact about the run rather than a claim about the day.
 */
export function verdictOf(digest: DigestSummary): DigestVerdict | null {
  return digest.sections.recommendations?.verdict ?? null;
}

/**
 * The serif line at the top: the advisor's summary if it wrote one, otherwise
 * the first headline an analyst did write.
 *
 * The fallback is not a consolation prize — before the advisor gained a
 * `summary` field this is the only whole-day sentence a digest contains, and
 * it is a real one written about real figures. `null` only when nothing at all
 * was written, which is the failed run's own branch.
 */
export function summaryOf(digest: DigestSummary): string | null {
  return digest.sections.recommendations?.summary ?? headlineOf(digest) ?? null;
}

/**
 * The first headline a member would actually read, whichever section wrote one.
 *
 * `null` rather than a sentence when nothing was written: the caller decides
 * whether that means "this run failed" (the digest panel) or "nothing to show
 * on this row" (the history list), and those need different words.
 */
export function headlineOf(digest: DigestSummary): string | null {
  return (
    digest.sections.sales?.headline ??
    digest.sections.debts?.headline ??
    digest.sections.stock?.headline ??
    digest.sections.team?.headline ??
    null
  );
}

/**
 * "6 actions · 2 high", and on a partial run the honest tail the canvas draws:
 * "· no stock actions tonight".
 *
 * The tail names the *missing analysts*, not the missing actions. An advisor
 * that finished can only recommend restocking if the stock analyst reported,
 * so an actions list with no restock on it is ambiguous — it means either "the
 * shelves are fine" or "nobody looked". Saying which is the difference between
 * a reader trusting the list and a reader being misled by it.
 */
export function actionsSummary(digest: Digest): string {
  const actions = digest.sections.recommendations?.actions ?? [];
  const high = actions.filter((action) => action.priority === "high").length;
  const parts = [
    `${actions.length} ${actions.length === 1 ? "action" : "actions"}`,
    `${high} high`,
  ];

  const missing = (["sales", "debts", "stock", "team"] as const).filter(
    (key) => digest.sections[key] === null,
  );
  if (missing.length > 0) {
    parts.push(`no ${missing.join(" or ")} actions tonight`);
  }

  return parts.join(" · ");
}
