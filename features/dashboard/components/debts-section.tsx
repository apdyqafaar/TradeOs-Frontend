import { cn } from "cn";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardDebtsSection } from "@/features/dashboard/types";
import { formatDate } from "@/lib/format/date";

type MoneyFormatter = (amount: number) => string;

/**
 * The labelled mono figure the Debts, Stock, Team and My-sales panels all draw
 * above their list (design canvas artboard `1c`).
 *
 * It lives here, in the first panel that uses it, rather than in a shared file:
 * Task 11's file list is exactly ten components and has no room for one, and
 * four copies of the same twelve lines would drift apart the first time the
 * canvas moves a padding. If a fifth caller appears outside this feature, lift
 * it to `components/shared/`.
 */
export function PanelFigure({
  label,
  value,
  note,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  /** The second line — a count beside an amount, never a second amount. */
  note?: string;
  /** A text colour class. The canvas paints overdue money red and warnings amber. */
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[22px] font-medium whitespace-nowrap",
          tone,
        )}
      >
        {value}
      </span>
      {note ? (
        <span className="text-xs text-muted-foreground">{note}</span>
      ) : null}
    </div>
  );
}

interface DebtsSectionProps {
  section: DashboardDebtsSection;
  money: MoneyFormatter;
  timezone: string;
}

/**
 * Outstanding credit and the worst overdue accounts (design canvas artboard
 * `1c`, left of the Debts/Stock band).
 *
 * `overdueCount` is the *full* count while `overdue` is capped at ten upstream,
 * so the difference is stated rather than implied — a list that silently stops
 * at ten reads as "these are all of them".
 *
 * `dueWithin7Days` is drawn as a third figure. The canvas has only two, but the
 * number arrives free in the same payload and it is the one figure on the panel
 * that is actionable *before* an account goes bad.
 */
export function DebtsSection({ section, money, timezone }: DebtsSectionProps) {
  const hidden = Math.max(0, section.overdueCount - section.overdue.length);

  return (
    <SectionStrip
      title="Debts"
      actions={
        <Link
          href={ROUTES.debts}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      }
      className="flex flex-col"
    >
      <div className="flex flex-wrap gap-x-8 gap-y-4 border-b border-border px-[18px] py-4">
        <PanelFigure label="Outstanding" value={money(section.outstanding)} />
        <PanelFigure
          label="Overdue"
          value={money(section.overdueAmount)}
          note={`${section.overdueCount} ${section.overdueCount === 1 ? "account" : "accounts"}`}
          tone="text-destructive"
        />
        <PanelFigure
          label="Due in 7 days"
          value={money(section.dueWithin7Days.amount)}
          note={`${section.dueWithin7Days.count} ${section.dueWithin7Days.count === 1 ? "account" : "accounts"}`}
          tone="text-warning-strong"
        />
      </div>

      {section.overdue.length === 0 ? (
        <EmptyState
          title="Nothing overdue"
          description="Accounts past their due date appear here, worst first."
        />
      ) : (
        <>
          <div className="grid h-[34px] grid-cols-[1.4fr_0.9fr_0.8fr] items-center gap-3 border-b border-border bg-muted/50 px-[18px] sm:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr]">
            <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              Customer
            </span>
            <span className="text-right font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              Remaining
            </span>
            <span className="text-center font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              Overdue
            </span>
            <span className="hidden text-right font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase sm:inline">
              Due
            </span>
          </div>

          <ul className="flex flex-col">
            {section.overdue.map((debt) => (
              <li
                key={debt.debtId}
                className="grid h-12 grid-cols-[1.4fr_0.9fr_0.8fr] items-center gap-3 border-b border-border/60 px-[18px] last:border-b-0 sm:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr]"
              >
                <span className="flex min-w-0 flex-col">
                  {/* The backend falls both fields back to "" when the customer
                      row has gone, so neither may be rendered bare. */}
                  {/* Links to the DEBT, not the customer. This row exists
                      because something is overdue, and the next action is
                      against that account — recording a payment or reading its
                      history — not browsing the person. `debtId` is on the row
                      for exactly this; the customer has their own page, reached
                      from the debt. */}
                  <Link
                    href={ROUTES.debt(debt.debtId)}
                    className="truncate text-[13px] text-foreground hover:underline"
                  >
                    {debt.customer.name || "Unnamed customer"}
                  </Link>
                  {debt.customer.phone ? (
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {debt.customer.phone}
                    </span>
                  ) : null}
                </span>
                <span className="text-right font-mono text-[13px] text-foreground">
                  {money(debt.remaining)}
                </span>
                <span className="inline-flex h-[22px] items-center justify-self-center rounded-lg bg-destructive-soft px-2 font-mono text-[11px] font-medium text-destructive-strong">
                  {debt.daysOverdue}d
                </span>
                <span className="hidden text-right font-mono text-xs text-muted-foreground sm:inline">
                  {formatDate(debt.dueDate, timezone)}
                </span>
              </li>
            ))}
          </ul>

          {hidden > 0 ? (
            <Link
              href={ROUTES.debts}
              className="border-t border-border px-[18px] py-2.5 text-xs font-medium text-primary hover:underline"
            >
              and {hidden} more overdue
            </Link>
          ) : null}
        </>
      )}
    </SectionStrip>
  );
}
