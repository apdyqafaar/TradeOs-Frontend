import { cn } from "cn";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { PanelFigure } from "@/features/dashboard/components/debts-section";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { StatCard } from "@/features/dashboard/components/stat-card";
import type {
  DashboardMySalesRecent,
  DashboardMySalesSection,
} from "@/features/dashboard/types";
import { formatTime } from "@/lib/format/date";

type MoneyFormatter = (amount: number) => string;

/** The pill in the receipts list. Three states, and none of them is an error. */
const PAYMENT_STATUS: Record<
  DashboardMySalesRecent["paymentStatus"],
  { label: string; className: string }
> = {
  paid: { label: "Paid", className: "bg-success-soft text-success-strong" },
  partial: {
    label: "Partial",
    className: "bg-warning-soft text-warning-strong",
  },
  credit: { label: "Credit", className: "bg-info-soft text-info-strong" },
};

interface MySalesSectionProps {
  section: DashboardMySalesSection;
  money: MoneyFormatter;
  /** The business's IANA zone. A receipt's time is the shop's time, not the reader's. */
  timezone: string;
  /**
   * How this block sits on the page — the answer to "a Manager receives BOTH
   * `mySales` and `sales`".
   *
   * `mySales` is gated on `sales:create`, an *action* permission, so anyone who
   * can work the counter gets it: a Seller, and equally an Owner or Manager who
   * also rings up sales. They are not an either/or role switch, and the design
   * canvas draws no manager treatment for `mySales` at all (artboard `1c` has
   * none; `1e` gives it the whole page). So the page decides by what else
   * arrived, never by a role name:
   *
   * - `primary` — no `sales` section came back, so the caller's own figures ARE
   *   the business figures as far as they can see. Three stat cards plus the
   *   receipt list, exactly as artboard `1e` draws it.
   * - `secondary` — `sales` came back too, so the headline grid belongs to the
   *   business and this is the caller's personal till underneath it: the same
   *   two totals as a compact figures row above the receipts, in the shape the
   *   Debts and Stock panels already use. Nothing is dropped and nothing is
   *   duplicated — a manager's own takings are a real fact their dashboard
   *   should not silently discard because the artboard omitted it.
   */
  variant: "primary" | "secondary";
}

/**
 * The caller's own sales — three stat cards and the last five receipts
 * (design canvas artboard `1e`).
 *
 * The canvas draws a customer column in the receipt row. `mySales.recent`
 * carries `{ id, number, total, paymentStatus, createdAt }` and no customer at
 * all, so the column is absent rather than blank; see `docs/findings/task-11.md`.
 */
export function MySalesSection({
  section,
  money,
  timezone,
  variant,
}: MySalesSectionProps) {
  const { today, thisMonth, recent } = section;

  return (
    <div className="flex flex-col gap-6">
      {variant === "primary" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="My sales today"
            value={String(today.count)}
            foot="completed sales"
          />
          <StatCard
            label="My revenue today"
            value={money(today.total)}
            foot="what I rang up"
          />
          <StatCard
            label="My month"
            value={money(thisMonth.total)}
            delta={`${thisMonth.count} sales`}
            foot="month to date"
          />
        </div>
      ) : null}

      <SectionStrip
        title={variant === "primary" ? "My recent receipts" : "My sales"}
        info="Your own completed sales. Voided ones are excluded."
        actions={
          <Link
            href={ROUTES.sales}
            className="text-xs font-medium text-primary hover:underline"
          >
            All my sales
          </Link>
        }
      >
        {variant === "secondary" ? (
          <div className="flex flex-wrap gap-x-8 gap-y-4 border-b border-border px-[18px] py-4">
            <PanelFigure
              label="Today"
              value={money(today.total)}
              note={`${today.count} sales`}
            />
            <PanelFigure
              label="This month"
              value={money(thisMonth.total)}
              note={`${thisMonth.count} sales`}
            />
          </div>
        ) : null}

        {recent.length === 0 ? (
          <EmptyState
            title="No receipts yet"
            description="Your last five completed sales appear here."
          />
        ) : (
          <ul className="flex flex-col">
            {recent.map((sale) => {
              const status = PAYMENT_STATUS[sale.paymentStatus];
              return (
                <li
                  key={sale.id}
                  className="grid h-12 grid-cols-[1fr_auto] items-center gap-3 border-b border-border/60 px-[18px] last:border-b-0 sm:grid-cols-[1fr_0.6fr_0.9fr_0.9fr]"
                >
                  {/* The receipt number opens the receipt. It is the cell a
                      cashier is already looking for — "what was that last
                      sale?" — and `sales:view` is in the Seller preset, so
                      everyone who can see this section can open what it lists. */}
                  <Link
                    href={ROUTES.sale(sale.id)}
                    className="truncate font-mono text-[13px] text-foreground hover:underline"
                  >
                    {sale.number}
                  </Link>
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                    {formatTime(sale.createdAt, timezone)}
                  </span>
                  <span
                    className={cn(
                      "hidden h-6 items-center gap-1.5 justify-self-start rounded-lg px-2.5 text-xs font-medium sm:inline-flex",
                      status.className,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-current"
                    />
                    {status.label}
                  </span>
                  <span className="text-right font-mono text-[13px] text-foreground">
                    {money(sale.total)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionStrip>
    </div>
  );
}
