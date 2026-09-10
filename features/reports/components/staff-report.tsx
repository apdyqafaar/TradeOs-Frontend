"use client";

import { UsersRound } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { ReportShell } from "@/features/reports/components/report-shell";
import { useStaffSales } from "@/features/reports/hooks/use-reports";
import { moneyIn, percentOf } from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import type { StaffSalesItem } from "@/features/reports/types";
import { isPeriodError } from "@/lib/period";

/**
 * The staff report — `/reports/staff`.
 *
 * One request, and the widest row in the feature: three independent aggregates
 * merged server-side, so **a member appears if they hit any one of them**. A
 * member who only took debt repayments shows `0` sales and a real `collected`,
 * which is a true row rather than a broken one — and the reason the table
 * shows all five figures instead of ranking on revenue alone.
 *
 * `items` is **not limited** (§3.7), so unlike every other ranked report on
 * this screen `share` really is each member's share of the business's total.
 * The column says "of revenue" rather than "of the rows shown" because here
 * that is true.
 */
export function StaffReport() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const staff = useStaffSales(params);

  if (staff.error?.status === 403) return <ForbiddenScreen />;

  const refused = staff.error !== null && isPeriodError(staff.error);
  const rows = staff.data?.items ?? [];

  return (
    <ReportShell
      title="Staff report"
      period={period}
      setPeriod={setPeriod}
      echo={staff.data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {staff.error && !refused ? <ErrorCard error={staff.error} /> : null}

      <SectionStrip
        title="By member"
        info="Sales are the ones each member rang up; Collected is debt repayments they received, never money taken at the till. A member with no activity at all does not appear."
      >
        <DataTable
          caption="Sales and collections by member for the selected period"
          rows={rows}
          isLoading={staff.isPending || organizationLoading}
          // The **Member** id, not a User id — the signed-in person's `/auth/me`
          // id will never match it (§3.7).
          getRowId={(row: StaffSalesItem) => row.key}
          columns={[
            {
              key: "label",
              header: "Member",
              // `"Removed member"` is the API's own fallback for a member whose
              // user row is gone, so it arrives as a name and needs no handling
              // here — unlike `customers/top`, which sends no label at all.
              cell: (row) => row.label,
            },
            {
              key: "salesCount",
              header: "Sales",
              align: "end",
              cell: (row) => String(row.salesCount),
            },
            {
              key: "revenue",
              header: "Revenue",
              align: "end",
              cell: (row) => money(row.revenue),
            },
            {
              key: "share",
              header: "Share",
              align: "end",
              hideBelowMd: true,
              cell: (row) => percentOf(row.share),
            },
            {
              key: "profit",
              header: "Profit",
              align: "end",
              hideBelowMd: true,
              cell: (row) => money(row.profit),
            },
            {
              key: "collected",
              header: "Collected",
              align: "end",
              hideBelowMd: true,
              cell: (row) => money(row.collected),
            },
            {
              key: "voidsCount",
              header: "Voids",
              align: "end",
              hideBelowMd: true,
              cell: (row) => String(row.voidsCount),
            },
          ]}
          emptyState={
            <EmptyState
              title="Nobody recorded anything"
              description="No member rang up a sale, voided one, or took a repayment in this period."
              icon={UsersRound}
            />
          }
        />
      </SectionStrip>
    </ReportShell>
  );
}
