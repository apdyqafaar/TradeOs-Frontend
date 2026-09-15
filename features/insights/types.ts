import type { AiLanguage } from "@/features/organization/types";

/**
 * The domain shapes `/digests/*` returns.
 *
 * Taken verbatim from Task F1's brief, which mirrors the backend's digest
 * shapers — no field here is guessed from a name.
 */

export type DigestStatus = "complete" | "partial" | "failed";
export type StoppedBy = "complete" | "budget" | "hops" | "error";

/**
 * The six windows a manual run can ask for — `DIGEST_PERIOD_PRESETS` in
 * `Backend/src/lib/digest-period.ts`, verbatim.
 *
 * **This is not the reports vocabulary and must never be merged with it.**
 * `periodQueryFields` on every `/reports/*` endpoint is `today | week | month |
 * year`, and the two disagree about what they mean: `last7` is a rolling seven
 * days ending today, where `week` is the calendar week from Monday. Reusing the
 * reports period type or its control here would silently relabel one as the
 * other.
 */
export const DIGEST_PERIOD_PRESETS = [
  "today",
  "last7",
  "last30",
  "last90",
  "year",
  "custom",
] as const;
export type DigestPeriodPreset = (typeof DIGEST_PERIOD_PRESETS)[number];

/**
 * The window a digest actually covers, resolved server-side in the shop's own
 * timezone and stored on the row so the label cannot drift.
 *
 * **`to` is EXCLUSIVE** — the instant one calendar day after the last day
 * included, like every other `to` in this API. A digest of 08–14 September
 * carries `to` = local midnight opening the **15th**, so printing it directly
 * is off by one on every range on the page. `formatDigestPeriod` in
 * `lib/period.ts` is the single place that subtracts the day.
 *
 * Optional on a digest: rows written before 2026-09-15 have no period at all,
 * and `publicDigest` omits the key rather than inventing `today` for them.
 */
export interface DigestPeriod {
  preset: DigestPeriodPreset;
  /** ISO 8601 instant. Inclusive. */
  from: string;
  /** ISO 8601 instant. **Exclusive.** */
  to: string;
}

/** What `POST /digests/run` accepts. `from`/`to` only with `preset: "custom"`. */
export interface RunDigestInput {
  preset?: DigestPeriodPreset;
  /** Bare `yyyy-MM-dd`, inclusive. Refused unless the preset is `custom`. */
  from?: string;
  /** Bare `yyyy-MM-dd`, inclusive. Refused unless the preset is `custom`. */
  to?: string;
}
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
 * All four are live — `figureSchema` in `Backend/src/services/ai/schemas.ts`
 * (`d0042ad`) — and the debts analyst uses `"days"`.
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
 * **`direction`, `deltaPct` and `tone` are each optional on the wire**, and an
 * absent `tone` is `neutral` — never a tone derived from the label, and never
 * from the sign of `deltaPct`. Only the analyst that read the day knows whether
 * a given number is bad news for this shop.
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

/**
 * One bucket of a small trailing series.
 *
 * **Oldest first**, at most 12. The bar chart and the sparklines both render
 * left to right in exactly that order — never reversed here, never re-sorted:
 * the labels are the model's own short axis strings ("MON", "08 Sep") and
 * sorting them as text would scramble a week.
 */
export interface SeriesPoint {
  label: string;
  value: number;
}

/**
 * The structured half of a section: the numbers a chart or a stat card can be
 * drawn from, beside the prose an owner actually reads.
 *
 * **Three different "no numbers" cases reach this type, and all three must
 * render as "nothing to draw" rather than crash:**
 *
 *  1. `figures: []` — required on the wire but legitimately empty. A day with
 *     nothing in it is a real answer, not missing data.
 *  2. `series` absent — optional on the wire and frequently omitted; the model
 *     is told to leave it out when there is nothing worth plotting.
 *  3. **`figures` absent entirely** — `sections` is a Mongoose `Mixed` field
 *     and no migration was run, so every row written before 2026-09-15 has no
 *     `figures` key at all. That includes the only digest this shop actually
 *     has, which is therefore the first row its owner will open.
 *
 * Case 3 is why `figures` is optional here while the zod schema requires it:
 * typing it as required would make `tsc` agree with a page that calls
 * `undefined.map` on the one row that exists.
 */
interface SectionNumbers {
  /** 0..4. Absent on rows written before the field existed — see above. */
  figures?: SectionFigure[];
  /** 0..12, oldest first. Optional on the wire and often omitted. */
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

/**
 * Why an analyst was never dispatched.
 *
 * **A closed set with one member today, and it will grow** — so it is treated
 * as an enum and **never rendered**. Printing `"no-activity"` at a shop owner
 * is printing our internal vocabulary at them, and a value added later would
 * appear on their screen as a raw slug the day it ships. `SECTION_QUIET_COPY`
 * maps it to words, with a fallback for a reason this build has not heard of.
 */
export const DIGEST_SKIP_REASONS = ["no-activity"] as const;
export type DigestSkipReason = (typeof DIGEST_SKIP_REASONS)[number];

/** One entry in `skipped`: which analyst stood down, and why. */
export interface SkippedSection {
  section: SectionKey;
  reason: DigestSkipReason;
}

export interface RecommendationsSection extends SectionNumbers {
  actions: RecommendationAction[];
  warnings: string[];
  /**
   * Required by the shipped schema and **still optional here**: rows written
   * before 2026-09-15 carry neither, for the no-migration reason
   * `SectionNumbers` gives. `verdictOf` returns null for those and the page
   * falls back to the run's `status` pill.
   */
  verdict?: DigestVerdict;
  /** The one serif 26px line at the top of the page. Absent for the same reason. */
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
  /** The shop-local day the digest was WRITTEN on, and the row's identity. */
  localDate: string;
  /**
   * The window it is ABOUT, which is no longer the same thing: a row stamped
   * "14 September" can legitimately summarise 08–14 September. Absent on rows
   * written before the field existed.
   */
  period?: DigestPeriod;
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
  /**
   * Sections whose analyst was **never dispatched**, because the shop had no
   * activity of that kind in the period. A quiet day, not a failure — the third
   * state a section can be in, beside "delivered" and "did not finish".
   *
   * **A quiet section's `sections.<key>` is `null`, exactly as a failed one's
   * is.** `null` alone cannot tell the two apart: membership here is the only
   * discriminator, and absence from `errors` is the confirmation. Any code that
   * branches on `section == null` calls every quiet section a failure, which is
   * the bug this field exists to prevent — and a small shop has quiet days
   * constantly, so that bug would fire on the most ordinary day it has.
   *
   * Always present on the wire and `[]` on rows written before it existed;
   * optional here because a defensive read costs nothing.
   */
  skipped?: SkippedSection[];
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
/**
 * The 202 from `POST /digests/run`.
 *
 * It carries the **new quota inline**, so the header count updates from the
 * mutation's own answer and no refetch of `GET /digests/quota` is needed. The
 * 429 refusal carries the same four fields in `details`, so the count is right
 * whether the run was accepted or refused.
 */
export interface RunDigestResult {
  localDate: string;
  period: DigestPeriod;
  quota: DigestQuota;
}

/**
 * `GET /digests/quota` — how many manual runs are left today. Gated
 * `reports:view`, **not** `organization:update`: every artboard renders the
 * count, including for a viewer who can never press Generate.
 *
 * It answers even when the shop has no digest at all, which is why it is its
 * own request rather than a field on `latest` — the empty screen is exactly
 * where "2 of 2 left today" belongs.
 */
export interface DigestQuota {
  /**
   * Manual runs allowed per shop per day — `AI_MANUAL_RUNS_PER_DAY`, which
   * **defaults to 2, not 3**. The canvas's "2 of 3 left today" was drawn
   * against the old in-memory limiter. Always render the string from `limit`
   * and `remaining`; a literal here is wrong on the shipped default and wrong
   * again for any deployment that tunes it.
   */
  limit: number;
  used: number;
  /** Clamped at 0 server-side, so lowering the limit mid-day never renders negative. */
  remaining: number;
  /** ISO 8601 instant of the shop's next local midnight, when `used` returns to 0. */
  resetsAt: string;
}
