import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ImportWizard } from "@/features/product-import/components/import-wizard";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Import products",
};

/**
 * The product import wizard (design canvas artboard `2e`).
 *
 * A Server Component holding the metadata and the gate, nothing else: every
 * step of the wizard reads or writes the API from the browser, so the client
 * boundary starts at `ImportWizard`.
 *
 * All ten `/products/import` endpoints gate on the same single permission,
 * `products:create` (`docs/contracts/product-import.md` §0) — there is no
 * separate "import" permission — and `ROUTE_PERMISSIONS` in `config/routes.ts`
 * already keys `/products/import` on it, so `requirePageAccess` resolves the
 * right one without this file naming it.
 */
export default async function ProductImport() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation from /products, which does not re-run the layout. See
  // `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <ImportWizard />;
}
