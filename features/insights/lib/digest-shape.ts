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
 * The analyst's name as it reads inside a sentence — "team", not "Team &
 * projects".
 */
export const SECTION_SUBJECTS: Record<SectionKey, string> = {
  sales: "sales",
  debts: "debts",
  stock: "stock",
  team: "team",
  recommendations: "advisor",
};

/**
 * What a quiet section says, in the owner's words.
 *
 * **Never "skipped".** That is our internal word for it and it sounds like a
 * failure; what actually happened is that the shop had a quiet day in that
 * one subject, which is ordinary and frequent for a small shop. The copy names
 * the absence of the ACTIVITY, not the absence of the analyst, and carries no
 * warning tone at all — nothing went wrong.
 */
export const SECTION_QUIET_COPY: Record<SectionKey, string> = {
  sales: "No sales were recorded in this period.",
  debts: "No debts were owed, paid or fell due in this period.",
  stock: "No stock moved in this period.",
  team: "No staff sales or project updates in this period.",
  recommendations: "Nothing came up that needs doing tomorrow.",
};

/**
 * The three states one section can be in.
 *
 * A boolean cannot hold this, which is the point: "the analyst did not finish"
 * and "there was nothing for the analyst to read" are opposite news that both
 * arrive as a `null` section, and only one of them is a shortfall. Everything
 * on the screen — the chips, the count, the stand-in card, the actions tail —
 * reads this one value rather than re-deciding it, so the two can never be
 * rendered inconsistently on the same page.
 */
export type SectionState =
  | { kind: "delivered" }
  /** Dispatched and could not finish. The canvas's minus-icon rows describe this. */
  | { kind: "failed"; reason?: string }
  /** Never dispatched: the shop had no activity of that kind. Not an error. */
  | { kind: "quiet" };

/**
 * **The one place the wire is read into a section state.**
 *
 * The backend field that marks a quiet section is `skipped` on the digest row
 * and **its name is not final** — it is being decided as this ships. That is
 * why the mapping lives in exactly one function: when it changes, this is the
 * line, plus its declaration in `features/insights/types.ts`. Nothing else in
 * the feature touches `digest.skipped`, and nothing else compares a section to
 * `null`.
 *
 * Order matters. A section that arrived is `delivered` whatever any other
 * field says — a row that is both present and listed as quiet is a backend
 * inconsistency, and rendering the content we actually have is the honest
 * resolution of it.
 */
export function readSectionState(
  digest: Pick<DigestSummary, "sections" | "errors" | "skipped">,
  key: SectionKey,
): SectionState {
  if (digest.sections[key] !== null) return { kind: "delivered" };
  if (digest.skipped?.includes(key)) return { kind: "quiet" };
  return {
    kind: "failed",
    reason: digest.errors.find((entry) => entry.section === key)?.message,
  };
}

/** All five states at once, in reading order. */
export function sectionStates(
  digest: Pick<DigestSummary, "sections" | "errors" | "skipped">,
): { key: SectionKey; label: string; state: SectionState }[] {
  return SECTION_ORDER.map((key) => ({
    key,
    label: SECTION_CHIP_LABELS[key],
    state: readSectionState(digest, key),
  }));
}

/**
 * How many of the five reported.
 *
 * **Not a backend field**, and **a quiet section counts as reported.** The
 * analyst answered the question it was asked; the answer was "nothing
 * happened", which is a complete report. Counting it as a shortfall would put
 * "3 of 5 analysts reported" at the top of an ordinary quiet Sunday and make a
 * working product look broken — the single most common day a small shop has.
 *
 * Only `failed` is missing from the count.
 */
export function analystsReported(
  digest: Pick<DigestSummary, "sections" | "errors" | "skipped">,
): number {
  return sectionStates(digest).filter((entry) => entry.state.kind !== "failed")
    .length;
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
 * The tail names the analysts that **failed**, not every analyst with no
 * section. An advisor that finished can only recommend restocking if the stock
 * analyst reported, so a list with no restock on it is ambiguous — it means
 * either "the shelves are fine" or "nobody looked", and only the reader being
 * told which can trust the list.
 *
 * A **quiet** analyst is deliberately not in the tail. Nothing went wrong and
 * nothing was missed: there was no stock movement to act on, so "no stock
 * actions tonight" would be true but would read as the shortfall it is not.
 */
export function actionsSummary(digest: Digest): string {
  const actions = digest.sections.recommendations?.actions ?? [];
  const high = actions.filter((action) => action.priority === "high").length;
  const parts = [
    `${actions.length} ${actions.length === 1 ? "action" : "actions"}`,
    `${high} high`,
  ];

  const failed = (["sales", "debts", "stock", "team"] as const).filter(
    (key) => readSectionState(digest, key).kind === "failed",
  );
  if (failed.length > 0) {
    parts.push(`no ${failed.join(" or ")} actions tonight`);
  }

  return parts.join(" · ");
}
