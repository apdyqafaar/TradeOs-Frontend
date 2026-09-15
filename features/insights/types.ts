import type { AiLanguage } from "@/features/organization/types";

/**
 * The domain shapes `/digests/*` returns.
 *
 * Taken verbatim from Task F1's brief, which mirrors the backend's digest
 * shapers — no field here is guessed from a name.
 */

export type DigestStatus = "complete" | "partial" | "failed";
export type StoppedBy = "complete" | "budget" | "hops" | "error";
export type SectionKey =
  | "sales"
  | "debts"
  | "stock"
  | "team"
  | "recommendations";

/**
 * What kind of number a figure is, so the screen cannot render a count as
 * money or a margin as a quantity.
 *
 * **`"money"` is a plain number in the shop's MAIN currency** — no currency
 * travels with a figure, exactly as no report payload carries one
 * (`features/reports/lib/format.ts`). It is formatted through
 * `lib/format/money.ts` with the code from `useCurrencyConfig()`, never a
 * symbol: this market mixes currencies whose symbols collide.
 *
 * `"days"` is in the rebuild brief's forecast of the contract but **not** in
 * the backend's own plan for it
 * (`Backend/docs/superpowers/plans/2026-09-15-digest-cost-and-presentation.md`
 * §5, which enumerates `money | count | percent`). Accepting the wider set
 * costs nothing and means a `days` figure renders rather than crashing a
 * `Record` lookup if the wider one is what ships.
 */
export type FigureUnit = "money" | "count" | "percent" | "days";

/**
 * Whether a figure is good news, and **the model says so, not the label.**
 * "Overdue" going up is bad and "Overdue" going down is good, and no amount of
 * reading the word "Overdue" tells a component which happened.
 */
export type FigureTone = "neutral" | "good" | "warn" | "bad";

/**
 * One number an analyst picked out of its own tool results. At most four per
 * section.
 *
 * **Every field but `label`, `value` and `unit` is optional, and the whole
 * array is optional on every section**, because as of 2026-09-15 the API sends
 * none of it: `Backend/src/services/ai/schemas.ts` still describes the five
 * sections as prose only. Task D of the backend plan adds it. Typing it as
 * required would make `tsc` agree with a page that renders `undefined.map`.
 */
export interface SectionFigure {
  label: string;
  value: number;
  unit: FigureUnit;
  direction?: "up" | "down" | "flat";
  /**
   * A **percentage**, not a fraction: `21.4` is "+21.4%".
   *
   * The opposite convention is live one screen away — `marginPct` and `share`
   * on the reports payloads are fractions despite their names
   * (`features/reports/types.ts`), and rendering one raw printed "0.38%" over
   * a healthy margin. `formatDeltaPct` is the one place this is decided, and
   * its test names both conventions so the next reader cannot mix them up.
   */
  deltaPct?: number;
  tone?: FigureTone;
}

/** One bucket of a small trailing series: at most 12, oldest first. */
export interface SeriesPoint {
  label: string;
  value: number;
}

/**
 * The structured half of a section: the numbers a chart or a stat card can be
 * drawn from, beside the prose an owner actually reads.
 *
 * Optional for the reason `SectionFigure` gives — nothing on the wire carries
 * them yet — so every consumer must handle their absence, and the page degrades
 * to prose rather than breaking.
 */
interface SectionNumbers {
  /** At most 4. */
  figures?: SectionFigure[];
  /** At most 12, oldest first. */
  series?: SeriesPoint[];
}

export interface SalesSection extends SectionNumbers {
  headline: string;
  points: string[];
  comparison: { vsLastWeek: string; monthToDate: string };
  anomalies: string[];
}
export interface DebtsSection extends SectionNumbers {
  headline: string;
  points: string[];
  accountsToChase: { customer: string; why: string }[];
}
export interface StockSection extends SectionNumbers {
  headline: string;
  points: string[];
  reorder: { product: string; why: string }[];
}
export interface TeamSection extends SectionNumbers {
  headline: string;
  people: string[];
  projects: string[];
}
export interface RecommendationAction {
  priority: "high" | "medium" | "low";
  kind: "chase" | "restock" | "review" | "promote" | "project" | "other";
  text: string;
}
/**
 * The advisor's one-word reading of the day. Drives the pill beside the
 * analyst count — **and is never inferred here.** "Good day" is a judgement,
 * and a page that derives one from whichever numbers it happens to have is
 * making it up; when this is absent the pill falls back to the run's own
 * `status`, which is a fact about the run rather than about the day.
 */
export type DigestVerdict = "good" | "mixed" | "poor" | "quiet";

export interface RecommendationsSection extends SectionNumbers {
  actions: RecommendationAction[];
  warnings: string[];
  /** Absent until the backend's Task D lands — see `SectionFigure`. */
  verdict?: DigestVerdict;
  /** The one serif line at the top of the page. Absent for the same reason. */
  summary?: string;
}
export interface DigestSections {
  sales: SalesSection | null;
  debts: DebtsSection | null;
  stock: StockSection | null;
  team: TeamSection | null;
  recommendations: RecommendationsSection | null;
}

/** One tool call an analyst made — parameters, a one-line summary, and the capped result it saw. */
export interface ToolTrace {
  seq: number;
  agent: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  output: unknown;
  ms: number;
}

export interface DigestSummary {
  id: string;
  localDate: string;
  timezone: string;
  language: AiLanguage;
  model: string;
  trigger: "cron" | "manual";
  requestedBy?: string;
  status: DigestStatus;
  stoppedBy: StoppedBy;
  /**
   * Present only on a `failed` run that ended in `error`
   * (`Backend/src/controller/digest.controller.ts`, `publicDigest`). It is the
   * difference between "the provider had a moment" and "nothing readable came
   * back all night", and it is the only thing that lets the failed screen
   * promise tonight's automatic run honestly: `systematic` means every agent
   * was given its full allowance and none ever answered, so a retry buys a
   * fourth failure.
   *
   * The API has sent this since `Backend` `447b38c`; this type simply did not
   * carry it, so the field was dropped on the floor between the wire and the
   * screen.
   */
  failureMode?: "systematic" | "transient";
  sections: DigestSections;
  errors: { section: SectionKey; message: string }[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    calls: number;
    routerCalls: number;
    costUsd: number;
  };
  generatedAt: string;
  createdAt: string;
}
export interface Digest extends DigestSummary {
  trace: ToolTrace[];
  /**
   * How many trace entries the run's cap dropped. Travels with the trace and
   * only with it, which is why it is here and not on `DigestSummary` — the
   * list endpoint sends neither (`publicDigest`'s `includeTrace` branch).
   * Optional because a row written before the field reads as absent, and the
   * shaper defaults it to 0 rather than omitting it on newer rows.
   */
  traceDropped?: number;
}
export interface RunDigestResult {
  localDate: string;
}

/**
 * `GET /digests/quota` — how many manual runs are left today.
 *
 * **This endpoint does not exist yet.** `Backend/src/routes/v1/digest.route.ts`
 * has four `/digests` rows and no quota among them; the three-a-day cap is
 * enforced by a `rateLimit` middleware that answers 429 after the fact and
 * publishes nothing a screen can read before the click. The rebuild brief says
 * a backend task is adding it, so the service and hook are here and the screen
 * renders the line only when it arrives — a 404 is silence, not an error card.
 */
export interface DigestQuota {
  /** Manual runs allowed per day. 3 today (`runLimiter`'s `max`). */
  limit: number;
  used: number;
  remaining: number;
  /** ISO 8601 instant the window rolls over. */
  resetsAt: string;
}
