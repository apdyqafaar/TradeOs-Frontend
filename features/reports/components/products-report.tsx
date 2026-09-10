"use client";

import { PackageX } from "lucide-react";
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionStrip } from "@/features/dashboard/components/section-strip";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { BreakdownRows } from "@/features/reports/components/breakdown-rows";
import { Figure, FigureGrid } from "@/features/reports/components/figure-grid";
import { ReportShell } from "@/features/reports/components/report-shell";
import { Segmented } from "@/features/reports/components/segmented";
import {
  useDeadStock,
  useStockReport,
  useTopProducts,
} from "@/features/reports/hooks/use-reports";
import { moneyIn } from "@/features/reports/lib/format";
import { toPeriodParams, useReportPeriod } from "@/features/reports/lib/period";
import type {
  DeadStockDays,
  StockRow,
  TopProductsBy,
} from "@/features/reports/types";
import { formatDate } from "@/lib/format/date";
import { formatQuantity } from "@/lib/format/money";
import { isPeriodError } from "@/lib/period";

const BY_OPTIONS = [
  { value: "revenue", label: "Revenue" },
  { value: "quantity", label: "Quantity" },
] as const;

/**
 * `limit` is capped at **50** on this endpoint, not the list convention's 100
 * (`report.validation.ts:27`), so 50 is the largest offer here. A hand-typed
 * `?limit=51` is a 422, which is why the URL value is normalised rather than
 * forwarded.
 */
const LIMITS = [10, 25, 50] as const;

/**
 * `days` is a `.refine()` on **three literal values**, not a range
 * (`report.validation.ts:37-42`) — `?days=45` is a 422, not a rounded 30.
 */
const DEAD_DAYS = [30, 60, 90] as const;

const PRODUCT_PARSERS = {
  by: parseAsStringLiteral(["revenue", "quantity"] as const).withDefault(
    "revenue",
  ),
  limit: parseAsInteger.withDefault(10),
  days: parseAsInteger.withDefault(30),
};

const safeLimit = (value: number): number =>
  (LIMITS as readonly number[]).includes(value) ? value : 10;

const safeDays = (value: number): DeadStockDays =>
  (DEAD_DAYS as readonly number[]).includes(value)
    ? (value as DeadStockDays)
    : 30;

/**
 * The products report — `/reports/products`.
 *
 * Three requests that answer three different questions about time, which is
 * why they are three panels and not one:
 *
 *  - **Top products** is period-scoped and its names are **snapshots taken at
 *    the moment of sale** — rename a product and last month's report keeps the
 *    old name. That is correct, and the panel says so.
 *  - **Stock** is point-in-time and takes **no parameters at all**; the period
 *    picker does not move it.
 *  - **Dead stock** is neither: its cutoff is a rolling wall-clock instant
 *    `days * 24h` ago, not a calendar boundary and not timezone-aware — the one
 *    place in this feature that is not (`docs/contracts/reports.md` §3.6).
 */
export function ProductsReport() {
  const [period, setPeriod] = useReportPeriod();
  const params = toPeriodParams(period);
  const [options, setOptions] = useQueryStates(PRODUCT_PARSERS, {
    history: "replace",
    scroll: false,
  });

  const limit = safeLimit(options.limit);
  const days = safeDays(options.days);

  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();
  const money = moneyIn(currency);

  const top = useTopProducts(params, options.by, limit);
  const stock = useStockReport();
  const dead = useDeadStock(days);

  if (
    top.error?.status === 403 ||
    stock.error?.status === 403 ||
    dead.error?.status === 403
  ) {
    return <ForbiddenScreen />;
  }

  const refused = top.error !== null && isPeriodError(top.error);

  return (
    <ReportShell
      title="Products report"
      period={period}
      setPeriod={setPeriod}
      echo={top.data?.period}
      refused={refused}
      timezone={timezone}
      currency={currency}
      organizationLoading={organizationLoading}
    >
      {top.error && !refused ? <ErrorCard error={top.error} /> : null}

      <SectionStrip
        title={`Top products · by ${options.by}`}
        info="Names are the product's name at the time of sale, so a renamed product keeps its old name in an older report. Share is of the rows shown, not of the period's revenue."
        actions={
          <>
            <Segmented
              label="Rank by"
              options={BY_OPTIONS}
              value={options.by}
              onChange={(value) =>
                void setOptions({ by: value as TopProductsBy })
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
          <Skeleton className="m-[18px] h-[200px] rounded-[8px]" />
        ) : top.data && top.data.items.length > 0 ? (
          <BreakdownRows
            valueLabel={options.by === "revenue" ? "Revenue" : "Quantity"}
            rows={top.data.items.map((item) => ({
              id: item.key,
              label: item.label,
              share: item.share,
              // `value` is `round2(quantity)` when ranking by quantity, but
              // `quantity` itself is unrounded to 3 dp for weighed goods — so
              // the raw field is what gets rendered, never `value`.
              value:
                options.by === "revenue"
                  ? money(item.revenue)
                  : formatQuantity(item.quantity),
              meta:
                options.by === "revenue"
                  ? formatQuantity(item.quantity)
                  : money(item.revenue),
            }))}
          />
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            No products were sold in this period.
          </p>
        )}
      </SectionStrip>

      <SectionStrip
        title="Stock · right now"
        info="Point in time, and unaffected by the period above. Active, stock-tracked products only — archived and untracked ones are invisible here."
      >
        {stock.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[100px] rounded-[8px]" />
        ) : stock.data ? (
          <FigureGrid className="lg:grid-cols-3">
            <Figure
              label="Tracked products"
              value={String(stock.data.trackedCount)}
              foot="active and stock-tracked"
            />
            <Figure
              label="Stock value"
              value={money(stock.data.stockValue)}
              foot="at cost"
            />
            <Figure
              label="Retail value"
              value={money(stock.data.retailValue)}
              foot="at selling price"
            />
          </FigureGrid>
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            The stock report could not be loaded.
          </p>
        )}
      </SectionStrip>

      {/*
        Two lists, never a sum of the two: a product with quantity 0 and a
        threshold set is in BOTH, so `lowStock.length + outOfStock.length`
        counts some products twice (§3.5).
      */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionStrip
          title="Low stock"
          info="At or under the product's own threshold. The 50 lowest quantities; a business with more low-stock products than that has more than this list shows."
        >
          <StockTable
            rows={stock.data?.lowStock ?? []}
            isLoading={stock.isPending}
            caption="Products at or under their low-stock threshold"
            emptyTitle="Nothing is running low"
            emptyBody="Every tracked product is above its threshold."
          />
        </SectionStrip>

        <SectionStrip
          title="Out of stock"
          info="Quantity is zero. A product with a threshold set appears in both lists, so the two cannot be added together."
        >
          <StockTable
            rows={stock.data?.outOfStock ?? []}
            isLoading={stock.isPending}
            caption="Products with no stock left"
            emptyTitle="Nothing is out of stock"
            emptyBody="Every tracked product has something on the shelf."
          />
        </SectionStrip>
      </div>

      <SectionStrip
        title={`Dead stock · unsold for ${days} days`}
        info="Products still in stock whose last sale is older than the cutoff, plus products never sold. The cutoff is a rolling instant — the same number of hours before now, not a calendar day."
        actions={
          <Segmented
            label="Unsold for"
            options={DEAD_DAYS.map((value) => ({
              value: String(value),
              label: `${value} days`,
            }))}
            value={String(days)}
            onChange={(value) => void setOptions({ days: Number(value) })}
          />
        }
      >
        {dead.isPending || organizationLoading ? (
          <Skeleton className="m-[18px] h-[160px] rounded-[8px]" />
        ) : dead.data && dead.data.items.length > 0 ? (
          <BreakdownRows
            valueLabel="Stock value"
            rows={dead.data.items.map((item) => ({
              id: item.key,
              // The live product name here, unlike Top products above. Two
              // reports, two name sources for the same product (§3.6).
              label: item.label,
              share: item.share,
              value: money(item.stockValue),
              meta:
                item.lastSoldAt === null
                  ? "never sold"
                  : `last sold ${formatDate(item.lastSoldAt, timezone)}`,
            }))}
          />
        ) : (
          <p className="px-[18px] py-6 text-[13px] text-muted-foreground">
            Everything in stock has sold inside the last {days} days.
          </p>
        )}
      </SectionStrip>
    </ReportShell>
  );
}

function StockTable({
  rows,
  isLoading,
  caption,
  emptyTitle,
  emptyBody,
}: {
  rows: StockRow[];
  isLoading: boolean;
  caption: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      isLoading={isLoading}
      // `productId`, not `id` — a deliberate deviation from the wire rule that
      // ids are called `id`, and the row key here depends on it.
      getRowId={(row) => row.productId}
      columns={[
        { key: "name", header: "Product", cell: (row) => row.name },
        {
          key: "quantity",
          header: "In stock",
          align: "end",
          cell: (row) => formatQuantity(row.quantity),
        },
        {
          key: "threshold",
          header: "Threshold",
          align: "end",
          // Absent from the JSON entirely when the product has no threshold —
          // `undefined`, not `null`, and only possible on an out-of-stock row.
          cell: (row) =>
            row.threshold === undefined ? "—" : formatQuantity(row.threshold),
        },
      ]}
      emptyState={
        <EmptyState
          title={emptyTitle}
          description={emptyBody}
          icon={PackageX}
        />
      }
    />
  );
}
