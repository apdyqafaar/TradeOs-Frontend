import { cn } from "cn";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import type {
  Digest,
  RecommendationAction,
  SectionKey,
} from "@/features/insights/types";
import { formatDate } from "@/lib/format/date";

const PRIORITY: Record<RecommendationAction["priority"], string> = {
  high: "bg-destructive-soft text-destructive-strong",
  medium: "bg-warning-soft text-warning-strong",
  low: "bg-muted text-muted-foreground",
};

/** One of the five boxes on the page. Plain container, no logic of its own. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-5">
      <h2 className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * What a card shows when its section is `null` — the analyst that owns it did
 * not finish before the run stopped (Backend spec §8, `stoppedBy`). The
 * numbers in every *other* card are still real; this just says which one is
 * missing and why it can be missing at all.
 */
function Missing({ what }: { what: SectionKey }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <AlertTriangle
        className="size-4 flex-none text-warning-strong"
        aria-hidden="true"
      />
      The {what} section could not be written last night — the rest of this
      digest is still real.
    </p>
  );
}

/** A plain bullet list. Every item is model-written text, rendered as a text node. */
function Lines({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px] text-foreground">
      {items.map((line) => (
        <li key={line} className="leading-relaxed">
          {line}
        </li>
      ))}
    </ul>
  );
}

/** An "**name** — why" row: `accountsToChase` and `reorder` share this shape. */
function WhyList({ rows }: { rows: { name: string; why: string }[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li
          key={row.name}
          className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-relaxed"
        >
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-muted-foreground">— {row.why}</span>
        </li>
      ))}
    </ul>
  );
}

export interface DigestViewProps {
  digest: Digest;
  /** IANA zone from `useOrganization()`. There is no safe default. */
  timezone: string;
}

/**
 * The five cards a shop owner actually reads: Sales · Debts · Stock · Team &
 * projects · What to do tomorrow.
 *
 * Every string here is model-written — a headline, a point, a warning — and
 * every one is rendered as a text node. Never `dangerouslySetInnerHTML`, never
 * markdown: a product named like an instruction is just a string on screen.
 *
 * `stoppedBy` names why a run ended before every section was written
 * (`"budget"`, `"hops"`, `"error"` — Backend spec §8). A `null` section is not
 * an error state to apologise for; it is an honest "this part did not finish",
 * and the sections that did finish are exactly as real as they would be on a
 * complete run.
 */
export function DigestView({ digest, timezone }: DigestViewProps) {
  const { sales, debts, stock, team, recommendations } = digest.sections;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        {formatDate(digest.generatedAt, timezone)}
        {digest.stoppedBy !== "complete"
          ? ` · Stopped early (${digest.stoppedBy}) — the sections below are what the analysts finished.`
          : null}
      </p>

      <Card title="Sales">
        {sales ? (
          <>
            <p className="font-serif text-foreground text-xl leading-tight">
              {sales.headline}
            </p>
            <Lines items={sales.points} />
            <p className="text-[13px] text-muted-foreground">
              {sales.comparison.vsLastWeek} · {sales.comparison.monthToDate}
            </p>
            {sales.anomalies.length > 0 ? (
              <Lines items={sales.anomalies} />
            ) : null}
          </>
        ) : (
          <Missing what="sales" />
        )}
      </Card>

      <Card title="Debts">
        {debts ? (
          <>
            <p className="font-serif text-foreground text-xl leading-tight">
              {debts.headline}
            </p>
            <Lines items={debts.points} />
            {debts.accountsToChase.length > 0 ? (
              <WhyList
                rows={debts.accountsToChase.map((account) => ({
                  name: account.customer,
                  why: account.why,
                }))}
              />
            ) : null}
          </>
        ) : (
          <Missing what="debts" />
        )}
      </Card>

      <Card title="Stock">
        {stock ? (
          <>
            <p className="font-serif text-foreground text-xl leading-tight">
              {stock.headline}
            </p>
            <Lines items={stock.points} />
            {stock.reorder.length > 0 ? (
              <WhyList
                rows={stock.reorder.map((line) => ({
                  name: line.product,
                  why: line.why,
                }))}
              />
            ) : null}
          </>
        ) : (
          <Missing what="stock" />
        )}
      </Card>

      <Card title="Team & projects">
        {team ? (
          <>
            <p className="font-serif text-foreground text-xl leading-tight">
              {team.headline}
            </p>
            <Lines items={team.people} />
            {team.projects.length > 0 ? <Lines items={team.projects} /> : null}
          </>
        ) : (
          <Missing what="team" />
        )}
      </Card>

      <Card title="What to do tomorrow">
        {recommendations ? (
          <>
            <ol className="flex flex-col gap-2">
              {recommendations.actions.map((action) => (
                <li
                  key={`${action.kind}:${action.text}`}
                  className="flex items-start gap-2 text-[13px] text-foreground"
                >
                  <span
                    className={cn(
                      "inline-flex h-[20px] flex-none items-center rounded-lg px-2 font-mono text-[10px] uppercase",
                      PRIORITY[action.priority],
                    )}
                  >
                    {action.kind}
                  </span>
                  <span className="leading-relaxed">{action.text}</span>
                </li>
              ))}
            </ol>
            {recommendations.warnings.length > 0 ? (
              <Lines items={recommendations.warnings} />
            ) : null}
          </>
        ) : (
          <Missing what="recommendations" />
        )}
      </Card>
    </div>
  );
}
