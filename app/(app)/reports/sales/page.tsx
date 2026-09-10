import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { SalesReport } from "@/features/reports/components/sales-report";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Sales report",
};

/**
 * The sales report (design canvas artboard `2i`).
 *
 * No row of its own in `ROUTE_PERMISSIONS`: `/reports/sales` inherits
 * `reports:view` from `/reports` by longest-prefix match, and that is exactly
 * the permission its three endpoints run on. A row here could only be wrong.
 */
export default async function ReportsSales() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <SalesReport />;
}
