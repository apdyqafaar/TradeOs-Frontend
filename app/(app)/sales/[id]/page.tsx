import type { Metadata } from "next";
import { Receipt } from "@/features/sales/components/receipt";

export const metadata: Metadata = {
  title: "Receipt",
};

/**
 * One sale, as a receipt (brief §6.4, design canvas artboard `2b`).
 *
 * A Server Component holding the metadata only; the client boundary starts at
 * `<Receipt>`, which owns the query, the customer lookup and the void dialog.
 *
 * `params` is a **Promise** in this version of Next — see
 * `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`,
 * "Creating a dynamic segment". Reading `params.id` directly compiles under
 * older type definitions and is `undefined` here.
 *
 * No permission gate of its own. `lib/auth/route-permissions.ts` matches by
 * longest prefix, so `/sales/<id>` inherits the `/sales` row — `sales:view` —
 * and `RouteGuard` in `app/(app)/layout.tsx` enforces it. A row of its own
 * would be a second place for the same fact to be wrong.
 *
 * The title stays the static word "Receipt": a `generateMetadata` that named
 * the sale would have to fetch it on the server, and this app's data layer is
 * cookie-authenticated React Query in the browser.
 */
export default async function SalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <Receipt saleId={id} />;
}
