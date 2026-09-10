"use client";

import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { BreakdownRows } from "@/features/reports/components/breakdown-rows";
import { ReportShell } from "@/features/reports/components/report-shell";
import { Segmented } from "@/features/reports/components/segmented";
import { useTopCustomers } from "@/features/reports/hooks/use-reports";
import { moneyIn, percentOf } from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import type { TopCustomersBy } from "@/features/reports/types";
import { isPeriodError } from "@/lib/period";

const BY_OPTIONS = [
  { value: "spend", label: "Spend" },
  { value: "balance", label: "Balance owed" },
] as const;

/** Capped at 50 on this endpoint, not the list convention's 100. */
const LIMITS = [10, 25, 50] as const;

const CUSTOMER_PARSERS = {
  by: parseAsStringLiteral(["spend", "balance"] as const).withDefault("spend"),
  limit: parseAsInteger.withDefault(10),
};

const safeLimit = (value: number): number =>
  (LIMITS as readonly number[]).includes(value) ? value : 10;

/**
 * The customers report — `/reports/customers`.
 *
 * One request, two modes, and the mode changes what time means:
 *
 *  - `by=spend` sums completed sales in the period, and **excludes walk-in
 *    sales** — the pipeline requires a `customerId`, so these rows add up to
 *    less than the sales report's revenue and always will.
 *  - `by=balance` sums open debts **as of now and ignores the period
 *    entirely**, while still accepting and echoing it
 *    (`docs/contracts/reports.md` §3.10).
 *
 * That second one is the trap this screen exists to not fall into: a period
 * picker sitting above a figure it cannot move. It is handled by saying so
 * beside the toggle, and by withholding the resolved-window caption from the
 * period bar in balance mode — a date range printed over a point-in-time
 * figure is a caption that is simply false.
 */
export function CustomersReport() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);
  const [options, setOptions] = useQueryStates(CUSTOMER_PARSERS, {
    history: "replace",
    scroll: false,
  });

  const limit = safeLimit(options.limit);
  const isBalance = options.by === "balance";

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const top = useTopCustomers(params, options.by, limit);

  if (top.error?.status === 403) return <ForbiddenScreen />;

  const refused = top.error !== null && isPeriodError(top.error);

  return (
    <ReportShell
      title="Customers report"
      period={period}
      setPeriod={setPeriod}
      echo={isBalance ? undefined : top.data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {top.error && !refused ? <ErrorCard error={top.error} /> : null}

      {isBalance ? (
        <p className="text-[13px] text-muted-foreground">
          Balances are what is owed <strong>right now</strong>. The period above
          still applies to the rest of Reports, but it does not change this
          list.
        </p>
      ) : null}

      <SectionStrip
        title={isBalance ? "Most owed · right now" : "Top customers · by spend"}
        info={
          isBalance
            ? "Open debts only — a debt paid off in full drops out of this list entirely. Share is of the customers shown."
            : "Sales recorded against a named customer. Walk-in sales have no customer and are not counted, so these will not add up to the period's revenue."
        }
        actions={
          <>
            <Segmented
              label="Rank by"
              options={BY_OPTIONS}
              value={options.by}
              onChange={(value) =>
                void setOptions({ by: value as TopCustomersBy })
              }
            />
            <Segmented
              label="How many"
              options={LIMITS.map((value) => ({
                value: String(value),
                label: `Top ${value}`,
              }))}
              value={String(limit)}
              onChange={(value) => void setOptions({ limit: Number(value) })}
            />
          </>
        }
      >
        {top.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[220px] rounded-[8px]" />
        ) : top.data && top.data.items.length > 0 ? (
          <BreakdownRows
            valueLabel={isBalance ? "Owed" : "Spend"}
            rows={top.data.items.map((item) => ({
              id: item.key,
              // `label` can be **absent from the JSON**: the `$lookup` has no
              // `$ifNull` fallback, unlike `staff/sales`'s "Removed member".
              // No hard-delete path for a customer exists, so this should never
              // fire — the cost of surviving it is one `??` and the failure
              // mode without one is a blank row.
              label: item.label ?? "Unknown customer",
              share: item.share,
              value: money(item.value),
              meta: percentOf(item.share),
            }))}
          />
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            {isBalance
              ? "No customer owes anything."
              : "No sales were recorded against a named customer in this period."}
          </p>
        )}
      </SectionStrip>
    </ReportShell>
  );
}
