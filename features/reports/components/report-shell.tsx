"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/config/routes";
import { PeriodBar } from "@/features/reports/components/period-bar";
import { ReportTabs } from "@/features/reports/components/report-tabs";
import type {
  ReportPeriod,
  SetReportPeriod,
} from "@/features/reports/lib/period";
import type { PeriodEcho } from "@/features/reports/types";

interface ReportShellProps {
  /** Serif, the canvas's 32px page title: "Sales report". */
  title: string;
  period: ReportPeriod;
  setPeriod: SetReportPeriod;
  /** The period the server resolved, off whichever request on the page echoes one. */
  echo?: PeriodEcho;
  /** True when the API answered one of the three period 400s. */
  refused?: boolean;
  timezone: string;
  /** The business's main currency code, or `""` when it has none configured. */
  currency: string;
  /** True until `useOrganization()` knows both facts. */
  organizationLoading: boolean;
  children: ReactNode;
}

/**
 * The chrome every report screen shares — artboard `2i`
 * (`docs/design/TradeOs-UI.dc.html:1086-1112`): the title, the tab strip, the
 * period bar, and the currency caveat when there is one.
 *
 * Two things the canvas draws are deliberately **not** here.
 *
 * **The "Export · coming soon" chip.** Nothing in this slice can be behind it —
 * there is no export endpoint anywhere in the reports contract — and a control
 * that does nothing is a worse answer than no control (the same call the
 * Overview made about its `…` menu).
 *
 * **The reserved "Highlights" card**, a dashed panel promising "a two or three
 * sentence read on the period". No endpoint produces that prose, and writing
 * it client-side would mean inventing a comparison against a period the API
 * was never asked about. A placeholder saying "coming later" would take the
 * best position on the page to say nothing.
 */
export function ReportShell({
  title,
  period,
  setPeriod,
  echo,
  refused,
  timezone,
  currency,
  organizationLoading,
  children,
}: ReportShellProps) {
  const currencyMissing = !organizationLoading && currency === "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
          {title}
        </h1>
      </header>

      <ReportTabs />

      <PeriodBar
        period={period}
        setPeriod={setPeriod}
        echo={echo}
        timezone={timezone}
        refused={refused}
      />

      {currencyMissing ? <CurrencyNotice /> : null}

      {children}
    </div>
  );
}

/**
 * Shown when the business has no currency configuration, so every amount on
 * the page is rendered without its code.
 *
 * Said out loud rather than hidden, and worded the same as the Overview's: a
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
