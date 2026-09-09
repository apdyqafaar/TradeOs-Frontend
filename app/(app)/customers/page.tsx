import type { Metadata } from "next";
import { CustomersPage } from "@/features/customers/components/customers-page";

export const metadata: Metadata = {
  title: "Customers",
};

/**
 * The customer book (brief §6.6, design canvas artboard `2h`).
 *
 * Stays a Server Component holding only the metadata: the list is filtered from
 * the URL and paged client-side, so the client boundary starts at
 * `CustomersPage` rather than here.
 *
 * `/customers` is already in `config/routes.ts` gated on `customers:view`, so
 * nothing needed adding there for this page to appear in the sidebar.
 */
export default function Customers() {
  return <CustomersPage />;
}
