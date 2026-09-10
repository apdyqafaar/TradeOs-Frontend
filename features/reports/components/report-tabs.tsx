"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/config/routes";

/**
 * The report screens, in the order artboard `2i` draws them
 * (`docs/design/TradeOs-UI.dc.html:1093-1099`), with the hub in front.
 *
 * **Hard-coded, because nothing on the wire enumerates the reports.** There is
 * no index endpoint — bare `GET /reports` is an alias of the dashboard, not a
 * catalogue (`docs/contracts/reports.md` §3.12) — so this list is the only
 * place the set exists, and a report without a row here is unreachable.
 */
const TABS = [
  { href: ROUTES.reports, label: "Overview" },
  { href: ROUTES.reportsSales, label: "Sales" },
  { href: ROUTES.reportsProducts, label: "Products" },
  { href: ROUTES.reportsDebts, label: "Debts" },
  { href: ROUTES.reportsCustomers, label: "Customers" },
  { href: ROUTES.reportsStaff, label: "Staff" },
] as const;

/**
 * The tab strip across the top of every report screen.
 *
 * **Links, not ARIA tabs.** The design draws tabs, but these are six routes,
 * each server-gated by `requirePageAccess()` before it renders. Making them
 * real tabs would mean one route holding six panels and a client-side gate
 * deciding which to show — the thing `app/(app)/layout.tsx` exists to prevent.
 * So it is `role="navigation"` styled as a tab strip, with `aria-current`
 * carrying the state `aria-selected` would have.
 *
 * **No tab is permission-hidden**, unlike `TeamTabs`. All six pages run on the
 * single `reports:view` (`docs/contracts/reports.md` §0), and `/reports/*`
 * inherits that row from `/reports` by longest-prefix match — so anyone who
 * can see this strip can open every page on it. A hidden tab here would be
 * hiding a screen from someone already cleared for it.
 *
 * The Overview tab is the one addition to the canvas's five. The hub is a real
 * screen and the sidebar's only entry point into this area; without a row it
 * would be reachable from the sub-pages only by the browser's back button.
 */
export function ReportTabs({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Reports"
      className={cn("flex flex-wrap gap-6 border-b border-border", className)}
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          // Exact match, not `startsWith`: every sub-path begins with
          // `/reports`, so a prefix test would light the Overview tab up on all
          // six screens.
          aria-current={pathname === tab.href ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
            pathname === tab.href
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
