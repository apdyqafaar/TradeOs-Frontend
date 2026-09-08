import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/config/routes";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import type { DashboardStaffSection } from "@/features/dashboard/types";

type MoneyFormatter = (amount: number) => string;

/**
 * First letter of the first and last name.
 *
 * A three-line copy of `components/layout/nav-utils.ts`'s `getInitials` on
 * purpose: that module is the shell's, this is a feature's, and importing
 * across the two to save three lines would couple every dashboard panel to the
 * layout's file layout. If a third caller appears, lift one of them to `lib/`.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

interface StaffSectionProps {
  section: DashboardStaffSection;
  money: MoneyFormatter;
}

/**
 * Today's top sellers (design canvas artboard `1c`, left of the Staff/Projects
 * band). The bar is each seller's share of the best seller's revenue, not of
 * the business's total — the section only carries the top five, so a share of
 * the whole would be a fraction of a number that is not on the page.
 */
export function StaffSection({ section, money }: StaffSectionProps) {
  const best = Math.max(0, ...section.today.map((row) => row.revenue));

  return (
    <SectionStrip
      title="Staff today"
      info="The five sellers with the most revenue today, in the business's own day."
      actions={
        <Link
          href={ROUTES.reportsStaff}
          className="text-xs font-medium text-primary hover:underline"
        >
          Staff report
        </Link>
      }
    >
      {section.today.length === 0 ? (
        <EmptyState
          title="No sales yet today"
          description="Whoever rings up a sale appears here."
        />
      ) : (
        <ul className="flex flex-col px-[18px] pt-1.5 pb-3">
          {section.today.map((row) => (
            <li
              key={row.memberId}
              className="flex h-[46px] items-center gap-3 border-b border-border/60 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="flex size-7 flex-none items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground"
              >
                {initials(row.name)}
              </span>
              <span className="w-[130px] flex-none truncate text-[13px] text-foreground">
                {row.name}
              </span>
              <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block">
                <span
                  className="block h-2 rounded-full bg-primary"
                  style={{
                    // `best` is 0 only when every seller sold nothing, which
                    // cannot reach here — the section lists sellers with sales.
                    width: `${best > 0 ? (row.revenue / best) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className="w-14 flex-none text-right font-mono text-[11px] text-muted-foreground">
                {row.count}
              </span>
              <span className="flex-none text-right font-mono text-[13px] text-foreground">
                {money(row.revenue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionStrip>
  );
}
