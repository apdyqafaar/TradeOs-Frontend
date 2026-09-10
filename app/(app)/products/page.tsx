import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ProductsPage } from "@/features/products/components/products-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Products",
};

/**
 * The catalogue (brief §6.5.1, design canvas artboard `2c`).
 *
 * Stays a Server Component holding only the metadata: the list is filtered
 * from the URL and paged client-side, so the client boundary starts at
 * `ProductsPage` rather than here.
 */
export default async function Products() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <ProductsPage />;
}
