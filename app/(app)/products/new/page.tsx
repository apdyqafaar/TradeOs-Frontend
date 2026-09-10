import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ROUTES } from "@/config/routes";
import { ProductForm } from "@/features/products/components/product-form";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "New product",
};

/**
 * Add a product (brief §6.5.2, the plan's Task 6).
 *
 * A Server Component holding the metadata and the title row only; the client
 * boundary starts at `<ProductForm>`. No permission gate of its own —
 * `ROUTE_PERMISSIONS` already maps `/products/new` to `products:create` and
 * `RouteGuard` in `app/(app)/layout.tsx` enforces it, which is stricter than
 * the `/products` parent for exactly this page.
 */
export default async function NewProduct() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          href={ROUTES.products}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Products
        </Link>
        <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
          New product
        </h1>
      </header>

      <ProductForm mode="create" />
    </div>
  );
}
