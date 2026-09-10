"use client";

import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemberNames } from "@/features/team/hooks/use-member-names";
import type { ObjectId } from "@/lib/api/types";

/**
 * Who did a thing, named — the one component every screen holding a `Member`
 * id renders it through.
 *
 * **Four payloads carry a bare member id and no name**: `Sale.soldBy` and
 * `Sale.voidedBy` (`publicSale` does `.toString()` on both,
 * `sale.controller.ts:42,44`), `StockMovement.createdBy`, and
 * `Payment.receivedBy`. None of them is a *user* id either, so it does not
 * match the signed-in user from `/auth/me` — only `GET /members` can turn one
 * into a person.
 *
 * Until the team slice existed those four cells rendered an em dash with the
 * id in `title`, which was the honest answer at the time: traceable for anyone
 * holding a disputed receipt, and not a fabricated name on a financial record.
 * `useMemberNames()` reads the shared directory query, so **ten tables asking
 * at once still cost one request** — which is what makes naming a whole page
 * of rows affordable where a per-row `GET /members/:id` never was.
 *
 * The dash is not gone, it is now the *fallback* rather than the answer, and
 * it is reached three ways that all mean "we cannot say":
 *
 * - the directory 403s (a custom role without `members:view`), so `isError`
 *   and every row falls back — the exact behaviour these screens had before;
 * - the member was removed from the organization and is no longer listed;
 * - the id belongs to another tenant, which should be unreachable.
 *
 * A **skeleton, not a dash, while the directory is in flight**: a dash means
 * "unknown" and a reader who sees one settle into a name learns not to trust
 * the first thing the cell says.
 */
export function MemberRef({
  memberId,
  action,
  prefix = "",
  className,
}: {
  memberId: ObjectId | null | undefined;
  /** The verb the description reads with: "Recorded", "Voided", "Received". */
  action: string;
  /** Visible text before the name, e.g. `"by "` in the receipt header. */
  prefix?: string;
  className?: string;
}) {
  const members = useMemberNames();
  const name = members.resolve(memberId);

  if (members.isLoading) {
    return (
      <Skeleton
        className={cn("h-[13px] w-24 rounded-[4px]", className)}
        // The row already reads its other cells; announcing "loading" per row
        // would make a twenty-row table say it twenty times.
        aria-hidden="true"
      />
    );
  }

  if (name) {
    return (
      <span className={cn("text-[13px] text-muted-foreground", className)}>
        {prefix}
        {name}
      </span>
    );
  }

  // Unresolvable. The id stays reachable in `title` — it is the only thing
  // that can settle an argument about a receipt.
  const description = `${action} by member ${memberId ?? "unknown"}`;

  return (
    // The dash is hidden from assistive tech and the full description read
    // instead, rather than hung on the span as an `aria-label` — a bare `span`
    // has no role, so ARIA naming on it is not supported and biome rejects it.
    <span
      className={cn("text-[13px] text-muted-foreground", className)}
      title={description}
    >
      <span aria-hidden="true">{prefix}—</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
