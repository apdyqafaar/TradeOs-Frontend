import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ProductDetail } from "@/features/products/components/product-detail";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "Product",
};

/**
 * One product (brief §6.5.3, design canvas artboard `2d`).
 *
 * A Server Component holding the metadata only; the client boundary starts at
 * `<ProductDetail>`, which owns the query, the edit form and the two dialogs.
 *
 * `params` is a **Promise** in this version of Next — see
 * `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`,
 * "Creating a dynamic segment". Reading `params.id` directly compiles under
 * older type definitions and is `undefined` here.
 *
 * No permission gate of its own. `lib/auth/route-permissions.ts` matches by
 * longest prefix, so `/products/<id>` inherits the `/products` row —
 * `products:view` — and `RouteGuard` in `app/(app)/layout.tsx` enforces it. A
 * row of its own would be a second place for the same fact to be wrong.
 *
 * The title stays the static word "Product": a `generateMetadata` that named it
 * would have to fetch the product on the server, and this app's data layer is
 * cookie-authenticated React Query in the browser. Naming the tab is not worth
 * a second, differently-authenticated path to the same endpoint.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  const { id } = await params;

  return <ProductDetail id={id} />;
}
