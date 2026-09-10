import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { CustomersReport } from "@/features/reports/components/customers-report";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Customers report",
};

/**
 * The customers report (design canvas artboard `2i`).
 *
 * Gated on `reports:view`, inherited from `/reports` — not on
 * `customers:view`, which is the list screen's permission and which a Seller
 * holds.
 */
export default async function ReportsCustomers() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <CustomersReport />;
}
