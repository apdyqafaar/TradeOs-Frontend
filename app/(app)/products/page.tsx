import type { Metadata } from "next";
import { ProductsPage } from "@/features/products/components/products-page";

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
export default function Products() {
  return <ProductsPage />;
}
