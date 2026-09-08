"use client";

import { tz } from "@date-fns/tz";
import { cn } from "cn";
import { format } from "date-fns";
import { Info, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useSession } from "@/features/auth/hooks/use-session";
import { AnnouncementsSection } from "@/features/dashboard/components/announcements-section";
import { DebtsSection } from "@/features/dashboard/components/debts-section";
import {
  FirstStepsCard,
  NothingToChartYet,
} from "@/features/dashboard/components/first-steps-card";
import { MySalesSection } from "@/features/dashboard/components/my-sales-section";
import { ProjectsSection } from "@/features/dashboard/components/projects-section";
import {
  SalesStatCards,
  SalesTrendSection,
} from "@/features/dashboard/components/sales-section";
import { StaffSection } from "@/features/dashboard/components/staff-section";
import { StockSection } from "@/features/dashboard/components/stock-section";
import { TeamSection } from "@/features/dashboard/components/team-section";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

/**
 * Morning / afternoon / evening **in the business's timezone**.
 *
 * Not the browser's: the owner of a Nairobi shop checking the takings from
 * London at 06:00 GMT is being greeted at the start of their staff's morning,
 * not the middle of their own night. The date line beneath the greeting names
 * the zone, so the two can never quietly disagree.
 */
function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(format(now, "H", { in: tz(timeZone) }));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The Overview, as one client component reading one `GET /dashboard`.
 *
 * There is no branch on a role anywhere below. The endpoint is
 * permission-shaped server-side: it builds only the sections the caller may
 * see and omits the rest entirely, so a Seller and an Owner render this same
 * component and differ only in which keys came back. An `if (isSeller)` here
 * would be a second, weaker copy of the server's rules that could only drift
 * from them.
 */
export function Overview({ name }: { name: string }) {
  const { data, isPending, error, refetch } = useDashboard();
  const {
    timezone,
    currency,
    isLoading: organizationLoading,
  } = useOrganization();
  const canRecordSale = useCan(PERMISSIONS.SALES_CREATE);

  const now = new Date();

  /**
   * Every amount on this page goes through here, so the currency is decided
   * once.
   *
   * `useOrganization().currency` is `""` when the business has no currency
   * configuration — a real state, because `organization.currency` on the wire
   * is `{ main, exchange, rate } | null`. There is then no code to give
   * `formatMoney`, and inventing one would print `USD 4,120.25` over a Kenyan
   * shop's takings and look entirely correct. So the figures render bare
   * (`formatMoney(x, "")` is `" 4,120.25"`, trimmed here) and `CurrencyNotice`
   * says why, out loud, once, at the top of the page.
   */
  const money = (amount: number) => formatMoney(amount, currency).trim();
  const currencyMissing = !organizationLoading && currency === "";

  const sections = data?.sections;
  const sales = sections?.sales;
  const mySales = sections?.mySales;
  const debts = sections?.debts;
  const stock = sections?.stock;
  const staff = sections?.staff;
  const projects = sections?.projects;
  const team = sections?.team;
  const announcements = sections?.announcements;

  /**
   * The brand-new-business state of artboard `1e`.
   *
   * The plan's rule is `thisMonth.count === 0` alone, which on the 1st of a
   * month would greet a three-year-old business with "Record your first sale".
   * The last seven days are checked too — they are already in the payload — so
   * the card appears only when there is genuinely nothing behind it.
   */
  const noSalesYet =
    sales !== undefined &&
    sales.thisMonth.count === 0 &&
    sales.trend7.series.every((bucket) => bucket.count === 0);

  /**
   * A caller with `sales:create` receives `mySales`; a caller with
   * `reports:view` receives `sales`; a Manager who works the counter holds
   * both. So `sales` — not a role name — decides whether the personal till is
   * the whole page or one panel on it. It is skipped entirely for a manager
   * with no receipts of their own: an empty personal panel under a full
   * business dashboard is noise, while for a Seller it is the point of the
   * screen and its empty state is the message.
   */
  const mySalesVariant = sales === undefined ? "primary" : "secondary";
  const showMySales =
    mySales !== undefined &&
    (mySalesVariant === "primary" || mySales.recent.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
            {greetingFor(now, timezone)}
            {name ? `, ${name}` : ""}.
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {`${format(now, "EEEE", { in: tz(timezone) })}, ${formatDate(now, timezone)} · ${timezone}`}
          </p>
        </div>

        {canRecordSale ? (
          <Button
            className="h-10 rounded-[10px] px-4 text-[13px]"
            render={<Link href={ROUTES.newSale} />}
          >
            <Plus className="size-4" aria-hidden="true" />
            New sale
          </Button>
        ) : null}
      </header>

      {currencyMissing ? <CurrencyNotice /> : null}

      {error ? (
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      {!error && (isPending || organizationLoading) ? (
        <OverviewSkeleton />
      ) : null}

      {!error && !isPending && !organizationLoading ? (
        <>
          {noSalesYet ? (
            <>
              <FirstStepsCard
                teamStarted={
                  team === undefined
                    ? undefined
                    : team.activeCount > 1 || team.invitedCount > 0
                }
              />
              <NothingToChartYet />
            </>
          ) : null}

          {sales !== undefined && !noSalesYet ? (
            <>
              <SalesStatCards section={sales} money={money} />
              <SalesTrendSection section={sales} currency={currency} />
            </>
          ) : null}

          {showMySales && mySales !== undefined ? (
            <MySalesSection
              section={mySales}
              money={money}
              timezone={timezone}
              variant={mySalesVariant}
            />
          ) : null}

          {debts !== undefined || stock !== undefined ? (
            <Band
              split={
                debts !== undefined && stock !== undefined ? "wide" : "single"
              }
            >
              {debts !== undefined ? (
                <DebtsSection
                  section={debts}
                  money={money}
                  timezone={timezone}
                />
              ) : null}
              {stock !== undefined ? <StockSection section={stock} /> : null}
            </Band>
          ) : null}

          {staff !== undefined || projects !== undefined ? (
            <Band
              split={
                staff !== undefined && projects !== undefined
                  ? "even"
                  : "single"
              }
            >
              {staff !== undefined ? (
                <StaffSection section={staff} money={money} />
              ) : null}
              {projects !== undefined ? (
                <ProjectsSection section={projects} timezone={timezone} />
              ) : null}
            </Band>
          ) : null}

          {announcements !== undefined || team !== undefined ? (
            <Band
              split={
                announcements !== undefined && team !== undefined
                  ? "wide"
                  : "single"
              }
            >
              {announcements !== undefined ? (
                <AnnouncementsSection
                  section={announcements}
                  timezone={timezone}
                />
              ) : null}
              {team !== undefined ? <TeamSection section={team} /> : null}
            </Band>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One of the canvas's two-column bands.
 *
 * `single` is not a styling preference — it is what happens when only one of a
 * band's two panels came back, which is routine: a Seller receives `debts` but
 * not `stock`. Keeping the `1.5fr 1fr` grid then would leave a lone card
 * beside a hole.
 */
function Band({
  split,
  children,
}: {
  /** `wide` is the canvas's `1.5fr 1fr`; `even` is `1fr 1fr`. */
  split: "wide" | "even" | "single";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-5",
        split === "wide" && "lg:grid-cols-[1.5fr_1fr]",
        split === "even" && "lg:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Shown when the business has no currency configuration, so every amount on
 * the page is rendered without its code. Said out loud rather than hidden: a
 * bare `4,120.25` with no explanation reads as a formatting bug, and a guessed
 * code would read as a fact.
 */
function CurrencyNotice() {
  return (
    <output className="flex items-start gap-2.5 rounded-[10px] border border-info/30 bg-info-soft px-4 py-3.5">
      <Info className="mt-px size-4 flex-none text-info" aria-hidden="true" />
      <p className="text-[13px] text-pretty text-info-strong">
        This business has no currency set, so the amounts below are shown
        without a currency code.{" "}
        <Link href={ROUTES.settings} className="font-medium underline">
          Set it in Settings
        </Link>
        .
      </p>
    </output>
  );
}

/**
 * The loading state in the shape of the page — the stat grid, the chart and
 * the first band. Never a spinner, and never over the header: the greeting and
 * the date are known without the request, so they are already on screen.
 */
function OverviewSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} className="h-[118px] rounded-[10px]" />
        ))}
      </div>
      <Skeleton className="h-[268px] rounded-[10px]" />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-[220px] rounded-[10px]" />
        <Skeleton className="h-[220px] rounded-[10px]" />
      </div>
    </>
  );
}

/**
 * The client boundary the Overview page renders.
 *
 * It exists only to read the signed-in person's first name off the session the
 * shell has already fetched, so `Overview` itself takes a plain string and
 * stays trivial to render in a test. The page above it stays a Server
 * Component holding the metadata.
 */
export function OverviewScreen() {
  const { data } = useSession();
  const firstName = (data?.user.name ?? "").trim().split(/\s+/)[0] ?? "";
  return <Overview name={firstName} />;
}
