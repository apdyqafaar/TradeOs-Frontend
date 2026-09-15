import type { ReactNode } from "react";
import { ROUTES } from "@/config/routes";
import { BarChart } from "@/features/dashboard/components/bar-chart";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { ActionsCard } from "@/features/insights/components/actions-card";
import { DigestFailedPanel } from "@/features/insights/components/digest-states";
import {
  DigestStatusBadge,
  VerdictPill,
} from "@/features/insights/components/digest-status";
import {
  SectionCard,
  SectionListLabel,
  SectionNote,
  WhyList,
} from "@/features/insights/components/section-card";
import {
  ANALYST_COUNT,
  analystsReported,
  heroFigures,
  readSectionState,
  SECTION_LABELS,
  SECTION_SUBJECTS,
  type SectionState,
  sectionStates,
  summaryOf,
  verdictOf,
} from "@/features/insights/lib/digest-shape";
import {
  formatDeltaPct,
  formatFigureValue,
  seriesLabels,
  seriesSummary,
  seriesValues,
  statDeltaTone,
} from "@/features/insights/lib/figures";
import type { Digest, SectionKey } from "@/features/insights/types";
import { axisTicks, compactNumber } from "@/features/reports/lib/format";

/**
 * The digest itself: numbers first, prose second, actions biggest — the
 * organising idea written at the top of the design canvas, in that order down
 * the page.
 *
 * Every string rendered here is model-written and every one is a text node.
 * Never `dangerouslySetInnerHTML`, never markdown: a product named like an
 * instruction is just a string on screen.
 *
 * One component for `/insights` and `/insights/:id` both, so the two screens
 * cannot describe the same digest differently — which they did, once, when one
 * of them rendered `status` and the other did not.
 *
 * **Nothing here decides what a section's absence means.** `readSectionState`
 * does, once, for all five; this only renders what it is told. A section that
 * did not run keeps its position on the page with a note in it — hiding one to
 * tidy the layout would make a partial run indistinguishable from a complete
 * one with fewer subjects.
 */
export function DigestView({
  digest,
  currency,
  action,
}: {
  digest: Digest;
  /** ISO 4217 code from `useCurrencyConfig()`. `""` while it is still loading. */
  currency: string;
  /** The Generate control, shown on the failed panel where the viewer may press it. */
  action?: ReactNode;
}) {
  // Spec §4.2 defines `failed` as "none" — the backend's own fixture for a
  // failed run writes all five sections null — so there is no "rest of this
  // digest" to reassure anyone about. `status` decides, not the sections:
  // nothing yet enforces that a failed run leaves all five null.
  if (digest.status === "failed") {
    return <DigestFailedPanel digest={digest} action={action} />;
  }

  const { sales, debts, stock, team } = digest.sections;
  const heroes = heroFigures(digest.sections);
  const verdict = verdictOf(digest);
  const summary = summaryOf(digest);
  const reported = analystsReported(digest);
  const stateOf = (key: SectionKey): SectionState =>
    readSectionState(digest, key);

  const salesSeries = sales?.series;

  return (
    <div className="flex flex-col gap-6">
      <VerdictRow
        digest={digest}
        reported={reported}
        verdict={verdict}
        summary={summary}
      />

      {heroes.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {heroes.map((hero) => (
            <StatCard
              key={hero.key}
              label={hero.figure.label}
              value={formatFigureValue(hero.figure, currency)}
              spark={seriesValues(hero.series)}
              delta={formatDeltaPct(hero.figure.deltaPct) ?? undefined}
              deltaTone={statDeltaTone(hero.figure)}
            />
          ))}
        </div>
      ) : null}

      {/* Actions left, sales right on a desktop; on a phone the sales card
          comes FIRST, which is the order artboard `1c` draws — a shape before
          a list. `order-first lg:order-none` does it in CSS, so neither layout
          waits on JavaScript to decide. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ActionsCard digest={digest} />

        <div className="order-first flex flex-col gap-5 lg:order-none">
          {sales ? (
            <SectionCard
              title="Sales"
              link={{ href: ROUTES.reportsSales, label: "Sales report" }}
              figures={sales.figures}
              currency={currency}
              headline={sales.headline}
              points={[...sales.points, ...sales.anomalies]}
              chart={
                salesSeries && salesSeries.length > 0 ? (
                  <RevenueChart
                    series={salesSeries}
                    currency={currency}
                    isMoney={sales.figures?.[0]?.unit === "money"}
                  />
                ) : undefined
              }
            >
              {sales.comparison.vsLastWeek || sales.comparison.monthToDate ? (
                <p className="px-[18px] pb-3.5 text-[13px] text-muted-foreground">
                  {[sales.comparison.vsLastWeek, sales.comparison.monthToDate]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </SectionCard>
          ) : (
            <SectionNote
              title={SECTION_LABELS.sales}
              subject={SECTION_SUBJECTS.sales}
              state={stateOf("sales")}
              quietKey="sales"
              link={{ href: ROUTES.reportsSales, label: "Sales report" }}
            />
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {debts ? (
          <SectionCard
            title={SECTION_LABELS.debts}
            link={{ href: ROUTES.debts, label: "Open debts" }}
            figures={debts.figures}
            currency={currency}
            headline={debts.headline}
            points={debts.points}
          >
            {debts.accountsToChase.length > 0 ? (
              <>
                <SectionListLabel>Chase first</SectionListLabel>
                <WhyList
                  rows={debts.accountsToChase.map((account) => ({
                    name: account.customer,
                    why: account.why,
                  }))}
                />
              </>
            ) : null}
          </SectionCard>
        ) : (
          <SectionNote
            title={SECTION_LABELS.debts}
            subject={SECTION_SUBJECTS.debts}
            state={stateOf("debts")}
            quietKey="debts"
            link={{ href: ROUTES.debts, label: "Open debts" }}
          />
        )}

        {stock ? (
          <SectionCard
            title={SECTION_LABELS.stock}
            link={{ href: `${ROUTES.products}?tab=low`, label: "Low stock" }}
            figures={stock.figures}
            currency={currency}
            headline={stock.headline}
            points={stock.points}
          >
            {stock.reorder.length > 0 ? (
              <>
                <SectionListLabel>Reorder</SectionListLabel>
                <WhyList
                  rows={stock.reorder.map((line) => ({
                    name: line.product,
                    why: line.why,
                  }))}
                />
              </>
            ) : null}
          </SectionCard>
        ) : (
          <SectionNote
            title={SECTION_LABELS.stock}
            subject={SECTION_SUBJECTS.stock}
            state={stateOf("stock")}
            quietKey="stock"
            link={{ href: `${ROUTES.products}?tab=low`, label: "Low stock" }}
          />
        )}

        {team ? (
          <SectionCard
            title={SECTION_LABELS.team}
            link={{ href: ROUTES.reportsStaff, label: "Staff report" }}
            figures={team.figures}
            currency={currency}
            headline={team.headline}
            points={[...team.people, ...team.projects]}
          />
        ) : (
          <SectionNote
            title={SECTION_LABELS.team}
            subject={SECTION_SUBJECTS.team}
            state={stateOf("team")}
            quietKey="team"
            link={{ href: ROUTES.reportsStaff, label: "Staff report" }}
          />
        )}
      </div>

      {digest.sections.recommendations === null ? (
        <SectionNote
          title={SECTION_LABELS.recommendations}
          subject={SECTION_SUBJECTS.recommendations}
          state={stateOf("recommendations")}
          quietKey="recommendations"
        />
      ) : null}
    </div>
  );
}

/**
 * The pill, the count, the chips, and the one serif line.
 *
 * The pill is the **advisor's** verdict when it wrote one and the **run's**
 * status when it did not — a fact about the day, or a fact about the run,
 * never a guess at the first dressed up as the second.
 *
 * The chips appear only when at least one of the five did not deliver. On a
 * complete run "5 of 5 analysts reported" is the whole story and five green
 * ticks beside it are decoration.
 */
function VerdictRow({
  digest,
  reported,
  verdict,
  summary,
}: {
  digest: Digest;
  reported: number;
  verdict: ReturnType<typeof verdictOf>;
  summary: string | null;
}) {
  const states = sectionStates(digest);
  const showChips = states.some((entry) => entry.state.kind !== "delivered");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {verdict ? (
          <VerdictPill verdict={verdict} />
        ) : (
          <DigestStatusBadge status={digest.status} size="md" />
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {reported} of {ANALYST_COUNT} analysts reported
        </span>
        {showChips ? (
          <>
            <span className="h-3.5 w-px bg-surface-3" aria-hidden />
            <ul className="flex flex-wrap gap-1.5">
              {states.map((entry) => (
                <li key={entry.key}>
                  <SectionChip label={entry.label} state={entry.state} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {/* Spec §11: `status` AND `stoppedBy` shown honestly. `budget` and
            `hops` are the run hitting its own ceiling rather than anything
            going wrong with the shop, and they are the difference between
            "two analysts failed" and "we stopped paying for the night". */}
        {digest.stoppedBy !== "complete" ? (
          <span className="font-mono text-[11px] text-muted-2">
            stopped early ({digest.stoppedBy})
          </span>
        ) : null}
      </div>
      {summary ? (
        <p className="max-w-[720px] font-serif text-[26px] text-foreground text-pretty leading-[1.25]">
          {summary}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One analyst's chip in the partial row.
 *
 * Three appearances for three states, and **the word is in the chip's own
 * text**, not only in its colour or its glyph — a reader hears "Stock, quiet",
 * not "Stock" three times in three hues. A quiet analyst is styled as plainly
 * as possible: nothing went wrong, and amber on an ordinary Sunday is an alarm
 * about a normal day.
 */
function SectionChip({ label, state }: { label: string; state: SectionState }) {
  const style =
    state.kind === "delivered"
      ? "border-success-soft bg-success-soft text-success-strong"
      : state.kind === "quiet"
        ? "border-border bg-transparent text-muted-foreground"
        : "border-warning-soft bg-warning-soft text-warning-strong";

  const word =
    state.kind === "delivered"
      ? "reported"
      : state.kind === "quiet"
        ? "quiet"
        : "did not finish";

  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-[7px] border px-2 font-mono text-[10px] tracking-[0.04em] ${style}`}
    >
      {label}
      <span className="opacity-70">· {word}</span>
    </span>
  );
}

/**
 * The seven-day revenue chart, drawn in CSS by the same `BarChart` the Overview
 * uses — bars on a four-line grid with a mono axis gutter. No charting library
 * for seven bars.
 *
 * The last bucket is the highlighted one: it is the day the digest is about,
 * and the canvas draws it in the accent with the rest receding.
 *
 * `axisLabels` are compact (`1.8k`), and the unit is named once in the header
 * legend rather than four times down a 10px gutter — but the chart's spoken
 * label carries the full formatted amount, because a screen reader has no
 * gutter to fit.
 */
function RevenueChart({
  series,
  currency,
  isMoney,
}: {
  series: NonNullable<Digest["sections"]["sales"]>["series"];
  currency: string;
  isMoney: boolean;
}) {
  const points = series ?? [];
  const values = seriesValues(points) ?? [];
  const max = Math.max(0, ...values);

  return (
    <div className="border-border border-b">
      <div className="flex items-center justify-between px-[18px] pt-3.5">
        <span className="flex items-center gap-1.5">
          <span className="size-[7px] rounded-full bg-chart-1" aria-hidden />
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
            {isMoney && currency ? currency : "Revenue"}
          </span>
        </span>
      </div>
      <BarChart
        series={values}
        bucketLabels={seriesLabels(points)}
        axisLabels={axisTicks(max).map((tick) => tick)}
        highlightIndex={values.length - 1}
        height={140}
        className="pt-3"
      />
      <span className="sr-only">
        {seriesSummary(points, (value) =>
          isMoney
            ? formatFigureValue({ label: "", value, unit: "money" }, currency)
            : compactNumber(value),
        )}
      </span>
    </div>
  );
}
