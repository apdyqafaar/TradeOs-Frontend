import { cn } from "cn";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { DigestStatusBadge } from "@/features/insights/components/digest-status";
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

/**
 * The priority, as a word.
 *
 * The pill used to read `action.kind` and carry `action.priority` only in its
 * colour, so `{high, chase, "Call Hodan Traders"}` and `{low, chase, "Call
 * Juma Kiosk"}` announced identically to a screen reader and differed only in
 * hue for everyone else — on the one card whose entire purpose is ranking
 * tomorrow's work. WCAG 1.4.1.
 */
const PRIORITY_LABEL: Record<RecommendationAction["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * The day, the status, and — when a run stopped short of the full five — why.
 *
 * `status` was rendered nowhere on `/insights` before, only in the history
 * list underneath, so the same digest was labelled "Failed" below and
 * unlabelled in the panel above it. Spec §11 asks for both shown honestly.
 */
function Header({ digest }: { digest: Digest }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
      <span>{formatDate(digest.generatedAt, digest.timezone)}</span>
      <DigestStatusBadge status={digest.status} />
      {digest.status !== "failed" && digest.stoppedBy !== "complete" ? (
        <span>
          Stopped early ({digest.stoppedBy}) — the sections below are what the
          analysts finished.
        </span>
      ) : null}
    </div>
  );
}

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
 *
 * `reason` is the matching entry from `digest.errors[]`, which the backend
 * writes one of per section that did not submit (spec §7.3) and which this
 * screen used to carry all the way through the types and into the fixture
 * before dropping it unrendered.
 */
function Missing({ what, reason }: { what: SectionKey; reason?: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
      <AlertTriangle
        className="mt-0.5 size-4 flex-none text-warning-strong"
        aria-hidden="true"
      />
      <span>
        The {what} section could not be written last night
        {reason ? ` — ${reason}` : ""}. The rest of this digest is still real.
      </span>
    </p>
  );
}

/**
 * A plain bullet list. Every item is model-written text, rendered as a text
 * node.
 *
 * Keyed by index, not by the line itself: this text is written by a language
 * model, and a repeated line is not hypothetical (a "batteries running low"
 * warning could easily be said twice). Keying by content would collide.
 */
function Lines({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px] text-foreground">
      {items.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: model-written lines carry no id and this list is never reordered independently of the digest it belongs to; a repeated line must not collide.
        <li key={index} className="leading-relaxed">
          {line}
        </li>
      ))}
    </ul>
  );
}

/**
 * An "**name** — why" row: `accountsToChase` and `reorder` share this shape.
 *
 * Keyed by index, not by `row.name`: two `accountsToChase` rows can legitimately
 * name the same customer for two different reasons, and the wire carries no
 * id for either row beyond the name.
 */
function WhyList({ rows }: { rows: { name: string; why: string }[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id beyond the customer/product name, which the model can legitimately repeat; this list is never reordered independently of the digest it belongs to.
          key={index}
          className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-relaxed"
        >
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-muted-foreground">— {row.why}</span>
        </li>
      ))}
    </ul>
  );
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
 * complete run — **unless the whole run failed**, which is its own branch
 * below.
 *
 * The date is rendered in `digest.timezone`, the zone this digest was written
 * in, not the organization's current one. Each row stores it
 * (`Backend/src/db/models/digest.model.ts:32`) precisely so that correcting a
 * wrong timezone in Settings does not make every historical row's rendered
 * time disagree with its own `localDate`. There is deliberately no `timezone`
 * prop, so reaching for the wrong zone is a compile error rather than a quiet
 * bug — the same reasoning as `insights-section.tsx`.
 */
export function DigestView({ digest }: { digest: Digest }) {
  const { sales, debts, stock, team, recommendations } = digest.sections;
  const reasonFor = (section: SectionKey) =>
    digest.errors.find((entry) => entry.section === section)?.message;

  // Spec §4.2 defines `failed` as "none" — the backend's own fixture for a
  // failed run writes all five sections `null` — and this used to render
  // "Stopped early (error) — the sections below are what the analysts
  // finished" above five cards each reassuring the reader that "the rest of
  // this digest is still real". Nothing is real; there is no rest.
  //
  // `status` decides, not the sections: nothing yet enforces that a `failed`
  // run leaves all five `null`, because the orchestrator that assigns
  // `status` is a separate, later task — and the Overview strip already
  // resolves the same ambiguity the same way (`insights-section.tsx`, and the
  // "status decides, not headline" case in `section-links.test.tsx`).
  if (digest.status === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <Header digest={digest} />
        <Card title="Last night's run">
          <p className="text-[13px] text-foreground leading-relaxed">
            This digest could not be written. The run stopped (
            {digest.stoppedBy}) before the analysts finished anything, so there
            is nothing here to read.
          </p>
          {digest.errors.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {digest.errors.map((entry, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: one entry per section that did not submit, carrying no id; the same section can appear more than once and the list is never reordered independently of the digest.
                  key={index}
                  className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-relaxed"
                >
                  <span className="font-medium text-foreground">
                    {entry.section}
                  </span>
                  <span className="text-muted-foreground">
                    — {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[13px] text-muted-foreground">
            Tonight's automatic run is unaffected.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header digest={digest} />

      <Card title="Sales">
        {sales ? (
          <>
            <p className="font-serif text-[22px] text-foreground">
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
          <Missing what="sales" reason={reasonFor("sales")} />
        )}
      </Card>

      <Card title="Debts">
        {debts ? (
          <>
            <p className="font-serif text-[22px] text-foreground">
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
          <Missing what="debts" reason={reasonFor("debts")} />
        )}
      </Card>

      <Card title="Stock">
        {stock ? (
          <>
            <p className="font-serif text-[22px] text-foreground">
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
          <Missing what="stock" reason={reasonFor("stock")} />
        )}
      </Card>

      <Card title="Team & projects">
        {team ? (
          <>
            <p className="font-serif text-[22px] text-foreground">
              {team.headline}
            </p>
            <Lines items={team.people} />
            {team.projects.length > 0 ? <Lines items={team.projects} /> : null}
          </>
        ) : (
          <Missing what="team" reason={reasonFor("team")} />
        )}
      </Card>

      <Card title="What to do tomorrow">
        {recommendations ? (
          <>
            <ol className="flex flex-col gap-2">
              {recommendations.actions.map((action, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: the same reasoning `Lines` and `WhyList` above carry — an action is model-written text with no id, and nothing in the advisor's prompt stops it emitting the same {kind, text} twice, which keying by content turned into two identical keys in one <ol>.
                  key={index}
                  className="flex items-start gap-2 text-[13px] text-foreground"
                >
                  <span
                    className={cn(
                      "inline-flex h-[20px] flex-none items-center rounded-lg px-2 font-mono text-[10px] uppercase",
                      PRIORITY[action.priority],
                    )}
                  >
                    {PRIORITY_LABEL[action.priority]} · {action.kind}
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
          <Missing
            what="recommendations"
            reason={reasonFor("recommendations")}
          />
        )}
      </Card>
    </div>
  );
}
