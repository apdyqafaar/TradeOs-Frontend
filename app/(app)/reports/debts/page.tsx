import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { DebtsReport } from "@/features/reports/components/debts-report";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Debts report",
};

/**
 * The debts report (design canvas artboard `2i`).
 *
 * Gated on `reports:view`, inherited from `/reports` — not on `debts:view`.
 * Both of its endpoints are report endpoints, and the Seller preset holds
 * `debts:view` without holding `reports:view`.
 */
export default async function ReportsDebts() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <DebtsReport />;
}
