import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { ROUTES } from "@/config/routes";
import { DebtForm } from "@/features/debts/components/debt-form";
import { requirePageAccess } from "@/lib/auth/require-page-access";

export const metadata: Metadata = {
  title: "New debt",
};

/**
 * Record a debt by hand — `POST /debts` (brief §6.5, artboard `2f`'s action).
 *
 * The gap this closes: not every debt comes from a sale. A credit sale raises
 * its own debt inside `POST /sales`, but stock lent on credit and a balance
 * carried forward from before this business used TradeOs had nowhere to go.
 *
 * A Server Component holding the metadata and the title row only; the client
 * boundary starts at `<DebtForm>`, which is where the customer search, the
 * amount and the mutation live. No permission gate of its own —
 * `ROUTE_PERMISSIONS` maps `/debts/new` to `debts:create` and `RouteGuard` in
 * `app/(app)/layout.tsx` enforces it, which is stricter than the `/debts`
 * parent for exactly this page: the Seller preset holds `debts:view` and would
 * otherwise reach a form whose every submit is a 403.
 *
 * **This static route wins over `/debts/[id]`.** Next resolves a static segment
 * before a dynamic sibling, so `/debts/new` renders this page rather than
 * `DebtDetail` asking the API for a debt whose id is the word "new".
 * `resolveRoutePermission` agrees by a different rule — longest guarded prefix
 * on a `/` boundary — so the two never disagree about which page this is.
 */
export default async function NewDebt() {
  // Server-side, on EVERY request for this page — including a client-side
  // navigation, which does not re-run the layout (Next: layouts "do not
  // re-render on navigation"). See `lib/auth/require-page-access.ts`.
  const { permitted } = await requirePageAccess();
  if (!permitted) return <ForbiddenScreen />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          href={ROUTES.debts}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Debts
        </Link>
        <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
          New debt
        </h1>
        <p className="max-w-[560px] text-pretty text-[13px] text-muted-foreground">
          For credit given outside a sale — stock lent on account, or a balance
          carried over from before this business used TradeOs. A credit sale
          raises its own debt at the counter.
        </p>
      </header>

      <DebtForm />
    </div>
  );
}
