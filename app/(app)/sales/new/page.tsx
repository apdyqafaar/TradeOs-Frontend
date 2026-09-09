import type { Metadata } from "next";
import { Counter } from "@/features/sales/components/counter/counter";

export const metadata: Metadata = {
  title: "New sale",
};

/**
 * The counter (design canvas artboard `2a`).
 *
 * A Server Component holding the metadata and nothing else — the whole screen
 * is one interaction, so the client boundary starts at `Counter` rather than
 * here, and the title row lives with it because the cashier's name and the
 * business's clock are client facts.
 *
 * No permission gate of its own: `ROUTE_PERMISSIONS` maps `/sales/new` to
 * `sales:create` and `RouteGuard` in `app/(app)/layout.tsx` enforces it, which
 * is stricter than the `/sales` parent for exactly this page. `Counter` hides
 * its submit on the same permission as well, for the role that loses it
 * mid-shift.
 */
export default function NewSale() {
  return <Counter />;
}
