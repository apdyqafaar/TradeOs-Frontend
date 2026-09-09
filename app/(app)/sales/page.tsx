import type { Metadata } from "next";
import { SalesPage } from "@/features/sales/components/sales-page";

export const metadata: Metadata = {
  title: "Sales",
};

/**
 * The sales journal (brief §6.4, design canvas artboard `2b`'s list sibling).
 *
 * Stays a Server Component holding only the metadata: the list is filtered
 * from the URL and paged client-side, so the client boundary starts at
 * `SalesPage` rather than here.
 *
 * `/sales` is already in `config/routes.ts` gated on `sales:view`, so nothing
 * needed adding there for this page to appear in the sidebar.
 */
export default function Sales() {
  return <SalesPage />;
}
