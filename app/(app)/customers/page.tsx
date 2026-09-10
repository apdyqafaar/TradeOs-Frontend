import type { Metadata } from "next";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { CustomersPage } from "@/features/customers/components/customers-page";
import { requirePageAccess } from "@/lib/auth/require-page-access";

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
export default async function Customers() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return <CustomersPage />;
}
