import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ProductsReport } from "@/features/reports/components/products-report";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Products report",
};

/**
 * The products report (design canvas artboard `2i`).
 *
 * Gated on `reports:view`, inherited from `/reports` — **not** on
 * `products:view`. Its three endpoints are report endpoints and run on the
 * former; a Seller holds `products:view` and would otherwise reach a screen
 * whose every request is a 403.
 */
export default async function ReportsProducts() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <ProductsReport />;
}
