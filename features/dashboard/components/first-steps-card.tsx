"use client";

import { cn } from "cn";
import { Check, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { PERMISSIONS } from "@/lib/auth/permissions";

interface FirstStepsCardProps {
  /**
   * True once a second member is active or an invitation is out.
   *
   * `undefined` when the caller did not receive the `team` section, which is
   * not the same as "nobody has been invited" — it means this build cannot
   * tell, and the row stays unticked rather than claiming either way.
   */
  teamStarted?: boolean;
}

/**
 * The brand-new-business checklist of design canvas artboard `1e`, shown in
 * place of the stat grid until the first sale is recorded.
 *
 * Each row is hidden when the caller cannot do the thing — a Seller sees only
 * "Record your first sale", because a checklist item they may not act on is a
 * dead end with a button that 403s.
 */
export function FirstStepsCard({ teamStarted }: FirstStepsCardProps) {
  const canAddProduct = useCan(PERMISSIONS.PRODUCTS_CREATE);
  const canRecordSale = useCan(PERMISSIONS.SALES_CREATE);
  const canInvite = useCan(PERMISSIONS.MEMBERS_INVITE);

  const steps = [
    {
      key: "product",
      visible: canAddProduct,
      // Nothing in `GET /dashboard` reports whether a product exists — the
      // `stock` section only counts the low and the out-of-stock ones, and both
      // are 0 for a business with no products AND for one whose shelves are
      // full. So this row can never tick; see `docs/findings/task-11.md`.
      done: false,
      label: "Add a product",
      note: "Products are what the counter sells and what stock alerts watch.",
      cta: "Add",
      href: ROUTES.products,
    },
    {
      key: "sale",
      visible: canRecordSale,
      // False by construction: this card only renders when there are no sales.
      done: false,
      label: "Record your first sale",
      note: "Revenue, profit and the trend all fill in from here.",
      cta: "New sale",
      href: ROUTES.newSale,
    },
    {
      key: "team",
      visible: canInvite,
      done: teamStarted === true,
      label: "Invite a teammate",
      note: "Sellers get their own till and see only their own figures.",
      cta: "Invite",
      href: ROUTES.team,
    },
  ].filter((step) => step.visible);

  if (steps.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-card p-6">
      <h2 className="font-serif text-2xl text-foreground">First steps</h2>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Three things and the counter is ready.
      </p>

      <ol className="flex flex-col">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-center gap-3.5 border-t border-border/60 py-3.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 flex-none items-center justify-center rounded-full border",
                step.done
                  ? "border-success/30 bg-success-soft text-success-strong"
                  : "border-border bg-muted text-muted-3",
              )}
            >
              <Check className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "text-sm font-medium",
                  step.done ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
                <span className="sr-only">{step.done ? " — done" : ""}</span>
              </span>
              <span className="text-xs text-muted-foreground">{step.note}</span>
            </span>
            <Button
              variant={step.done ? "ghost" : "outline"}
              className="h-[34px] flex-none rounded-[9px] px-3.5 text-[13px]"
              render={<Link href={step.href} />}
            >
              {step.cta}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What stands where the trend chart goes until there is something to plot
 * (design canvas artboard `1e`, right column).
 */
export function NothingToChartYet() {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[10px] border border-border bg-card px-8 py-10 text-center">
      <div className="mb-1 flex size-[52px] items-center justify-center rounded-xl border border-border bg-muted">
        <TrendingUp className="size-[22px] text-muted-3" aria-hidden="true" />
      </div>
      <p className="font-serif text-[22px] text-foreground">
        Nothing to chart yet
      </p>
      <p className="max-w-[280px] text-[13px] text-pretty text-muted-foreground">
        Your revenue trend, debts and stock alerts appear here after the first
        sale.
      </p>
    </div>
  );
}
