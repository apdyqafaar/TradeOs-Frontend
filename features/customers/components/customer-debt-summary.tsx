import { cn } from "cn";
import type { CustomerDebtSummary as DebtSummary } from "@/features/customers/types";
import { formatMoney } from "@/lib/format/money";

interface CustomerDebtSummaryProps {
  /** Straight off `GET /customers/:id`. Two counts and one amount — see below. */
  summary: DebtSummary;
  /**
   * The organization's main currency from `useOrganization()`. May be `""`
   * while a business has no currency config, which `formatMoney` renders as an
   * unlabelled number rather than guessing a code (Slice 2 global constraints).
   * The caller gates on `isLoading`; this component never fetches.
   */
  currency: string;
}

/**
 * What this customer owes — artboard `2h`, rendered honestly.
 *
 * **The canvas is wrong here, and this component is where that is settled.**
 * `2h` draws two money figures side by side, *Outstanding USD 76.50* and
 * *Overdue USD 0.00*. The API returns three numbers and only one of them is
 * money:
 *
 * ```js
 * // Backend/src/db/actions/debt.actions.ts:197-210 — customerDebtSummary
 * open:           { $sum: 1 },
 * overdue:        { $sum: { $cond: [{ $lt: ["$dueDate", now] }, 1, 0] } },
 * totalRemaining: { $sum: "$remaining" },
 * ```
 *
 * `open` and `overdue` are `$sum: 1` over the matched debts — they count rows.
 * `totalRemaining` is the only amount. So `formatMoney(summary.overdue, …)`
 * would print `USD 1.00` for a customer with one late debt of any size: a
 * currency figure that appears nowhere in the business's books, on the one
 * screen whose entire job is saying what somebody is owed. Overdue is
 * therefore rendered as a **count of debts** — "1 overdue" — and never with a
 * currency code.
 *
 * There is no endpoint that would fix this. An overdue *amount* would need the
 * debts themselves (`GET /debts?customerId=…&status=overdue`), which is Slice
 * 3; nothing in this slice may invent it. When that list lands, this panel can
 * gain a real overdue amount and the canvas becomes achievable — until then
 * the count is the whole truth available.
 *
 * Pure and presentational: no query, no permission gate, no currency lookup of
 * its own, so it is a plain render test with no providers.
 */
export function CustomerDebtSummary({
  summary,
  currency,
}: CustomerDebtSummaryProps) {
  /*
   * `totalRemaining` sums `remaining` across the open debts, so `open === 0`
   * already implies a zero total — the second half of this condition can only
   * fire on data that contradicts itself, and in that case showing the figures
   * is the more honest failure than swallowing them behind "nothing owed".
   */
  const owesNothing = summary.open === 0 && summary.totalRemaining === 0;

  if (owesNothing) {
    return (
      <section
        aria-label="Debt summary"
        className="rounded-[10px] border border-border bg-surface-2 px-[18px] py-4"
      >
        <p className="text-[13px] font-medium text-foreground">
          Nothing outstanding
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          This customer has no open debts.
        </p>
      </section>
    );
  }

  const openLabel = `across ${summary.open} open ${
    summary.open === 1 ? "debt" : "debts"
  }`;

  /*
   * "None overdue" rather than "0 overdue": the zero case is the good news on
   * this panel, and a bare 0 beside a live amount reads as a figure that
   * failed to load. "overdue" needs no plural — "2 overdue" is already right.
   */
  const overdueLabel =
    summary.overdue === 0 ? "None overdue" : `${summary.overdue} overdue`;

  return (
    <section
      aria-label="Debt summary"
      className="flex flex-wrap gap-8 rounded-[10px] border border-border bg-surface-2 px-[18px] py-4"
    >
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Outstanding
        </span>
        <span className="font-mono text-[22px] font-medium leading-none text-foreground">
          {formatMoney(summary.totalRemaining, currency)}
        </span>
        <span className="text-xs text-muted-foreground">{openLabel}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          Overdue
        </span>
        {/* Same size and weight as the amount beside it, because it carries the
            same weight; the unit is "debts", which is why it is not mono and
            not prefixed with a currency code. */}
        <span
          className={cn(
            "text-[22px] font-medium leading-none",
            summary.overdue === 0
              ? "text-muted-foreground"
              : "text-destructive",
          )}
        >
          {overdueLabel}
        </span>
        <span className="text-xs text-muted-foreground">
          {summary.overdue === 0
            ? "Nothing past its due date"
            : "Past the due date"}
        </span>
      </div>
    </section>
  );
}
