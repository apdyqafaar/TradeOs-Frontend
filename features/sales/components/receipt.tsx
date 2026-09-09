"use client";

import { cn } from "cn";
import {
  ArrowLeft,
  Printer,
  Receipt as ReceiptIcon,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useCustomer } from "@/features/customers/hooks/use-customer";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { MemberRef } from "@/features/sales/components/sale-table";
import { VoidSaleDialog } from "@/features/sales/components/void-sale-dialog";
import { useSale } from "@/features/sales/hooks/use-sale";
import type { Sale, SaleItem, SalePaymentStatus } from "@/features/sales/types";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate, formatTime } from "@/lib/format/date";
import {
  formatExchange,
  formatMoney,
  formatQuantity,
} from "@/lib/format/money";

/** Matches `<SaleTable>`, so a row and its receipt label a payment the same way. */
const PAYMENT_STATUS_STYLES: Record<SalePaymentStatus, string> = {
  paid: "bg-success-soft text-success-strong",
  partial: "bg-warning-soft text-warning-strong",
  credit: "bg-destructive-soft text-destructive-strong",
};

const PAYMENT_STATUS_LABELS: Record<SalePaymentStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  credit: "Credit",
};

/** The canvas's small uppercase mono label on every panel. */
const PANEL_LABEL =
  "font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground";

interface ReceiptProps {
  /** From the `[id]` route segment. Never empty — the page awaits `params`. */
  saleId: ObjectId;
}

/**
 * Was this failure "there is no such receipt", however it was phrased?
 *
 * Two statuses mean it, and only reading the backend says so:
 *
 * - **404 `NOT_FOUND`** — the sale does not exist, *or* it belongs to another
 *   business. `findSaleById` filters on `organizationId` first
 *   (`sale.actions.ts:25-26`), so a cross-tenant id is a 404 rather than a 403
 *   and an id cannot be probed (`list.test.ts:217-226`).
 * - **422 `VALIDATION_ERROR`** — the id is not 24 hex characters.
 *   `validate({ params: idParamSchema })` is the *first* link in the chain,
 *   before `requireAuth`, so `/sales/abc` never reaches the lookup
 *   (`docs/contracts/sales.md` §3, trap 6). This route takes no query and a
 *   GET carries no body, so a 422 from it can mean nothing else.
 *
 * Both are the same thing to the reader — a URL that points at no receipt — so
 * both get the not-found panel rather than a red card offering to retry a
 * request whose answer will not change.
 */
function isMissingSale(error: ApiError | null): boolean {
  if (!error) return false;
  return (
    error.status === 404 ||
    (error.status === 422 && error.code === API_ERROR_CODE.VALIDATION_ERROR)
  );
}

/**
 * A sale, as a receipt — brief §6.4 and artboard `2b`.
 *
 * **This is a financial record someone may be holding while disputing a
 * charge**, so every figure on it comes from the sale itself and nothing is
 * inferred. Three consequences run through the whole file:
 *
 *   1. **Lines are rendered from the sale's own snapshots.** `items[]` carries
 *      `name`, `barcode`, `unit`, `unitPrice`, `discount` and `lineTotal`
 *      frozen at sale time, so a product renamed, re-priced or archived since
 *      does not rewrite an old receipt. Re-pricing a line from
 *      `GET /products/:id` would show a customer a number they were never
 *      charged (`docs/contracts/sales.md` §5).
 *   2. **Nothing is populated.** `soldBy` and `voidedBy` are bare Member ids
 *      with no members endpoint in this build, so `<MemberRef>` prints an em
 *      dash carrying the id rather than a name this screen invented. The
 *      customer is the one exception, because one page about one sale can
 *      afford one `GET /customers/:id`.
 *   3. **Two of the payment figures are in a different currency from the rest**
 *      — `amountTendered` and `change` are in `payment.currency`, everything
 *      else is in the business's main currency — so the payment card labels
 *      which is which instead of leaving the reader to work it out.
 */
export function Receipt({ saleId }: ReceiptProps) {
  const saleQuery = useSale(saleId);
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  const canVoid = useCan(PERMISSIONS.SALES_VOID);
  const canViewCustomers = useCan(PERMISSIONS.CUSTOMERS_VIEW);
  const canViewDebts = useCan(PERMISSIONS.DEBTS_VIEW);

  const sale = saleQuery.data;

  /*
   * The one extra request this page allows itself. `customerId` is a bare id
   * and `GET /sales/:id` has no `?populate=`, so the name, phone and address
   * the canvas draws in the customer panel exist nowhere else.
   *
   * Passing `undefined` disables the query — which is what happens both before
   * the sale has landed and for a walk-in sale that has no customer at all.
   * It is also the gate for `customers:view`: every preset role holds it, but a
   * custom role need not, and a request that is going to 403 is not worth
   * making (`CLAUDE.md`: a caller without a permission sees nothing).
   */
  const customerQuery = useCustomer(
    canViewCustomers ? sale?.customerId : undefined,
  );

  const [voidOpen, setVoidOpen] = useState(false);

  const { error, isPending, refetch } = saleQuery;

  // Nothing failed and nothing is broken: this person may not read sales.
  // `RouteGuard` already gates `/sales/*` on `sales:view`, so arriving here
  // means a role changed under them.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  if (isMissingSale(error)) {
    return (
      <div className="flex flex-col gap-5">
        <EmptyState
          icon={ReceiptIcon}
          title="This receipt doesn't exist"
          description="The link may be out of date, or the sale may belong to another business."
          action={
            <Button variant="outline" render={<Link href={ROUTES.sales} />}>
              Back to sales
            </Button>
          }
        />
      </div>
    );
  }

  // A failure with nothing cached renders the card alone. Half a receipt under
  // it would read as a sale with no lines and nothing owed.
  if (error && !sale) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  /*
   * The currency and the timezone are held to the same bar as the sale itself.
   * `useOrganization` falls back to `""` and `"UTC"` while it loads, and a
   * receipt that printed `223.75` with no code, or a time that shifted an hour
   * once the shop's zone arrived, is exactly the kind of wrong a disputed
   * charge cannot afford. A moment more of skeleton is the cheaper mistake.
   */
  if (isPending || organizationLoading || !sale) {
    return <ReceiptSkeleton />;
  }

  const isVoided = sale.status === "voided";

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      {/* A refetch failed over a receipt already on screen: say so, keep it. */}
      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't refresh this receipt"
          retry={() => {
            void refetch();
          }}
        />
      ) : null}

      <article className="flex w-full max-w-[720px] flex-col gap-5 rounded-xl border border-border bg-card p-7">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                className={cn(
                  "font-medium font-mono text-[26px] leading-none",
                  isVoided ? "text-muted-2 line-through" : "text-foreground",
                )}
              >
                {sale.number}
              </h1>
              {isVoided ? (
                <span className="inline-flex h-6 items-center rounded-lg border border-border-strong px-2.5 font-medium text-[12px] text-muted-foreground">
                  Voided
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-lg px-2.5 font-medium text-[12px]",
                  PAYMENT_STATUS_STYLES[sale.paymentStatus],
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-current"
                />
                {PAYMENT_STATUS_LABELS[sale.paymentStatus]}
              </span>

              <span className="font-mono text-[12px] text-muted-foreground">
                {formatDate(sale.createdAt, timezone)} ·{" "}
                {formatTime(sale.createdAt, timezone)}
              </span>

              {/* The canvas reads "by Amina Mohamed" here. See `<MemberRef>`:
                  the "by" is the component's `prefix` rather than loose text
                  beside it, so a screen reader hears one description instead
                  of "by recorded by member …". */}
              <MemberRef
                memberId={sale.soldBy}
                action="Recorded"
                prefix="by "
                className="text-[12px]"
              />
            </div>
          </div>

          {/* `print:hidden` — the actions are for the screen; the paper copy
              this button produces should not carry a Void button. */}
          <div className="flex gap-2.5 print:hidden">
            <Button
              variant="outline"
              className="h-[38px] rounded-[10px] px-3.5 text-[13px]"
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" />
              Print
            </Button>

            {/*
              Hidden, not disabled, for a caller without `sales:void` — the
              Seller preset does not hold it (`permissions.ts:119-136`) and
              `CLAUDE.md` is explicit that a missing permission shows nothing.
              A sale that is already voided has no second transition, so the
              control goes for everyone.
            */}
            {canVoid && !isVoided ? (
              <Button
                variant="destructive"
                className="h-[38px] rounded-[10px] px-3.5 text-[13px]"
                onClick={() => setVoidOpen(true)}
                /*
                 * The canvas puts this rule on the button as a tooltip, and a
                 * tooltip is the only honest place for it: whether the debt has
                 * been paid against is not on this payload — it lives on the
                 * `Debt`, and `items[].trackStock` is not on the wire either
                 * (`docs/contracts/sales.md` trap 10). The button therefore
                 * cannot be pre-disabled without a second request that would
                 * still be a guess by the time it was clicked. The real 409
                 * `DEBT_HAS_PAYMENTS` is shown in the dialog, where the action
                 * is taken.
                 */
                title={
                  sale.debtId
                    ? "Void is unavailable once a payment has been taken on this sale's debt."
                    : undefined
                }
              >
                <Undo2 className="size-4" aria-hidden="true" />
                Void
              </Button>
            ) : null}
          </div>
        </header>

        {isVoided ? <VoidBanner sale={sale} timezone={timezone} /> : null}

        <CustomerPanel
          customerId={sale.customerId}
          canViewCustomers={canViewCustomers}
          query={customerQuery}
        />

        <ItemsTable items={sale.items} currency={currency} />

        <div className="grid gap-5 md:grid-cols-2">
          <Totals sale={sale} currency={currency} isVoided={isVoided} />
          <PaymentPanel
            sale={sale}
            currency={currency}
            timezone={timezone}
            canViewDebts={canViewDebts}
          />
        </div>

        {sale.note ? (
          <section className="flex flex-col gap-1.5">
            <h2 className={PANEL_LABEL}>Note</h2>
            {/* `whitespace-pre-line`: the field is a 500-character free text
                and people put a line per thing in it. */}
            <p className="whitespace-pre-line text-[13px] text-foreground">
              {sale.note}
            </p>
          </section>
        ) : null}
      </article>

      {/* Mounted only for a caller who may actually void, so its mutation hook
          is not wired up for a Seller who could never submit it. */}
      {canVoid && !isVoided ? (
        <VoidSaleDialog
          open={voidOpen}
          onOpenChange={setVoidOpen}
          sale={sale}
        />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href={ROUTES.sales}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground print:hidden"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Sales
    </Link>
  );
}

/**
 * The `danger`-soft banner a voided sale carries: reason · who · when.
 *
 * `voidReason` is required by the API on the way in
 * (`voidSaleSchema`, `min(1)`) but is `voidReason?: string` on the way out,
 * because `publicSale` copies an optional document field — a sale voided
 * before that field existed, or by a path this build has not seen, would have
 * none. The banner still says "Voided" in that case rather than rendering
 * "Voided · undefined".
 */
function VoidBanner({ sale, timezone }: { sale: Sale; timezone: string }) {
  return (
    // `<output>`, not a `div` with `role="status"`: it carries that role
    // implicitly, so the banner is announced when a void lands and the receipt
    // re-renders under the reader — without an ARIA role biome would ask to be
    // replaced by this element anyway.
    <output className="flex items-start gap-2.5 rounded-[10px] border border-destructive/30 bg-destructive-soft px-4 py-3.5">
      <Undo2
        className="mt-px size-4 flex-none text-destructive"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-[13px] text-destructive-strong">
          Voided{sale.voidReason ? ` · ${sale.voidReason}` : ""}
        </p>
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {sale.voidedBy ? (
            <MemberRef
              memberId={sale.voidedBy}
              action="Voided"
              className="text-[11px]"
            />
          ) : null}
          {sale.voidedAt ? (
            <>
              {sale.voidedBy ? "·" : null}
              {formatDate(sale.voidedAt, timezone)} ·{" "}
              {formatTime(sale.voidedAt, timezone)}
            </>
          ) : null}
        </p>
      </div>
    </output>
  );
}

/**
 * The customer strip — the one place this screen spends an extra request.
 *
 * Four states, and each is a different fact:
 *
 *   - **no `customerId`** — a walk-in. Stated, because "who bought this" is a
 *     question a disputed receipt asks and "nobody was recorded" is the answer.
 *   - **loading** — a skeleton, never a flash of the id.
 *   - **failed or not permitted** — the panel keeps its shape and says the name
 *     could not be loaded. The receipt is not degraded by it: everything else
 *     on this page comes from the sale, so a customer lookup that fails must
 *     not take the totals down with it.
 *   - **loaded** — name, phone · address, and a link through to their page.
 */
function CustomerPanel({
  customerId,
  canViewCustomers,
  query,
}: {
  customerId?: ObjectId;
  canViewCustomers: boolean;
  query: ReturnType<typeof useCustomer>;
}) {
  if (!customerId) {
    return (
      <div className="flex flex-col gap-0.5 rounded-[10px] border border-border bg-muted px-4 py-3.5">
        <span className={PANEL_LABEL}>Customer</span>
        <span className="font-medium text-[14px] text-foreground">Walk-in</span>
      </div>
    );
  }

  const customer = query.data?.customer;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-border bg-muted px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={PANEL_LABEL}>Customer</span>

        {customer ? (
          <>
            <span className="font-medium text-[14px] text-foreground">
              {customer.name}
            </span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {customer.phone}
              {customer.address ? ` · ${customer.address}` : ""}
            </span>
          </>
        ) : query.isPending && canViewCustomers ? (
          <>
            <Skeleton className="h-[18px] w-40" />
            <Skeleton className="mt-1 h-3.5 w-56" />
          </>
        ) : (
          // No name to show and no name to invent. The id stays reachable in
          // the tooltip so a dispute can still be traced.
          <span
            className="text-[13px] text-muted-foreground"
            title={`Customer ${customerId}`}
          >
            {canViewCustomers
              ? "This customer's details couldn't be loaded."
              : "On account — you don't have access to customer records."}
          </span>
        )}
      </div>

      {/* Offered whether or not the name loaded: the link is the recovery for
          a lookup that failed, not a decoration on one that worked. */}
      {canViewCustomers ? (
        <Link
          href={ROUTES.customer(customerId)}
          className="font-medium text-[13px] text-primary hover:underline print:hidden"
        >
          Open customer
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The lines, rendered from the sale and from nothing else.
 *
 * Columns follow the canvas: Item · Qty · Unit · Disc · Total. **`Unit` is the
 * unit *price*, not the unit of measure** — the unit of measure rides with the
 * quantity (`2 kg`), which is where a person reads it.
 *
 * Every amount here is in the business's **main** currency: `unitPrice`,
 * `discount` and `lineTotal` are all main-currency figures whatever the
 * customer tendered in (`docs/contracts/sales.md` §6).
 */
function ItemsTable({
  items,
  currency,
}: {
  items: SaleItem[];
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Items on this sale</caption>
        <thead>
          <tr className="bg-muted">
            <th
              scope="col"
              className={cn(PANEL_LABEL, "px-3.5 py-2 font-normal")}
            >
              Item
            </th>
            <th
              scope="col"
              className={cn(PANEL_LABEL, "px-3.5 py-2 text-right font-normal")}
            >
              Qty
            </th>
            <th
              scope="col"
              className={cn(PANEL_LABEL, "px-3.5 py-2 text-right font-normal")}
            >
              Unit
            </th>
            <th
              scope="col"
              className={cn(PANEL_LABEL, "px-3.5 py-2 text-right font-normal")}
            >
              Disc
            </th>
            <th
              scope="col"
              className={cn(PANEL_LABEL, "px-3.5 py-2 text-right font-normal")}
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            // `productId` is unique per sale — the backend refuses a repeated
            // one with "One line per product" — so it is a stable row key.
            <tr
              key={item.productId}
              className="border-border border-t first:border-t-0"
            >
              <td className="px-3.5 py-2.5">
                <span className="text-[13px] text-foreground">{item.name}</span>
                {item.barcode ? (
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {item.barcode}
                  </span>
                ) : null}
              </td>
              <td className="px-3.5 py-2.5 text-right font-mono text-[13px] text-foreground">
                {/* Up to 3 dp, with the unit beside it: goods sold by weight
                    are a real case here, not a rounding curiosity. */}
                {formatQuantity(item.quantity, item.unit)}
              </td>
              <td className="px-3.5 py-2.5 text-right font-mono text-[13px] text-muted-foreground">
                {formatMoney(item.unitPrice, currency)}
              </td>
              <td className="px-3.5 py-2.5 text-right font-mono text-[13px] text-muted-foreground">
                {/* An amount, never a percentage — both discounts on this API
                    are (`sale.validation.ts:17,29`). A zero prints as a dash so
                    the column reads as "nothing off" at a glance. */}
                {item.discount === 0
                  ? "—"
                  : `−${formatMoney(item.discount, currency)}`}
              </td>
              <td className="px-3.5 py-2.5 text-right font-mono text-[13px] text-foreground">
                {formatMoney(item.lineTotal, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Subtotal, the order-level discount, and the total the customer was charged. */
function Totals({
  sale,
  currency,
  isVoided,
}: {
  sale: Sale;
  currency: string;
  isVoided: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-between gap-4">
        <span className="text-[13px] text-muted-foreground">Subtotal</span>
        <span className="font-mono text-[13px] text-foreground">
          {formatMoney(sale.subtotal, currency)}
        </span>
      </div>

      {/*
        Rendered only when there was one. The order-level discount is a
        separate amount from the per-line discounts already shown in the table
        above, and a permanent "Sale discount  0.00" row invites the reader to
        add it to the line discounts twice.
      */}
      {sale.discount > 0 ? (
        <div className="flex justify-between gap-4">
          <span className="text-[13px] text-muted-foreground">
            Sale discount
          </span>
          <span className="font-mono text-[13px] text-foreground">
            −{formatMoney(sale.discount, currency)}
          </span>
        </div>
      ) : null}

      <div className="flex justify-between gap-4 border-border border-t pt-2.5">
        <span className={PANEL_LABEL}>Total</span>
        <span
          className={cn(
            "font-medium font-mono text-[20px]",
            isVoided ? "text-muted-2 line-through" : "text-foreground",
          )}
        >
          {formatMoney(sale.total, currency)}
        </span>
      </div>
    </div>
  );
}

/**
 * How it was paid — the panel where the currencies stop agreeing.
 *
 * `payment.currency` is what the customer actually handed over: the business's
 * main currency, or its exchange currency. **`amountTendered` and `change` are
 * in that currency; `amountPaidMain`, `amountDue` and every total above are in
 * the main currency.** There is no `amountTenderedMain` field to shortcut the
 * comparison (`docs/contracts/sales.md` §6, trap 5).
 *
 * `formatMoney` prints a code rather than a symbol on every line, so the two
 * are already distinguishable — and the caption at the foot says it in words
 * when they actually differ, because a receipt is read under pressure.
 *
 * `formatExchange` supplies the second line of the tendered figure. It
 * **multiplies** by `exchangeRate`, matching `toMain` in the backend's
 * `money.ts`: the rate is units of *main* per one unit of *exchange*. The
 * inverse reads more naturally out loud, which is exactly how it shipped
 * backwards once (`CLAUDE.md`, "Money direction").
 */
function PaymentPanel({
  sale,
  currency,
  timezone,
  canViewDebts,
}: {
  sale: Sale;
  currency: string;
  timezone: string;
  canViewDebts: boolean;
}) {
  const { payment } = sale;

  /*
   * Whether the tender was in a second currency. Compared on the code rather
   * than on `exchangeRate !== 1`, because a business whose exchange rate
   * happens to sit at 1.00 still tendered in another currency and still needs
   * the caption below.
   */
  const isExchange = payment.currency !== currency;

  const tendered = formatExchange(
    payment.amountTendered,
    payment.currency,
    payment.exchangeRate,
    currency,
  );

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted px-4 py-3.5">
      <span className={PANEL_LABEL}>Payment</span>

      <div className="flex items-start justify-between gap-4">
        <span className="text-[13px] text-muted-foreground">Tendered</span>
        <span className="flex flex-col items-end">
          <span className="font-mono text-[13px] text-foreground">
            {tendered.tendered}
          </span>
          {/* Only when a conversion actually happened. `converted` is `null`
              when the rate is unusable, which is the one case where showing it
              would print an Infinity on a receipt. */}
          {isExchange && tendered.converted ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {tendered.converted} · frozen
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[13px] text-muted-foreground">Paid</span>
        <span className="font-mono text-[13px] text-foreground">
          {formatMoney(payment.amountPaidMain, currency)}
        </span>
      </div>

      {/*
        Change is shown only when there was any — `max(0, …)` server-side, so a
        credit sale's is a hard zero — and it is the one figure here in the
        tendered currency. The label says so outright rather than relying on
        the reader noticing that the code differs from the line above.
      */}
      {payment.change > 0 ? (
        <div className="flex justify-between gap-4">
          <span className="text-[13px] text-muted-foreground">
            Change{isExchange ? ` (in ${payment.currency})` : ""}
          </span>
          <span className="font-mono text-[13px] text-foreground">
            {formatMoney(payment.change, payment.currency)}
          </span>
        </div>
      ) : null}

      <div className="flex justify-between gap-4 border-border border-t pt-2">
        <span className="text-[13px] text-muted-foreground">Amount due</span>
        <span
          className={cn(
            "font-medium font-mono text-[15px]",
            payment.amountDue > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {formatMoney(payment.amountDue, currency)}
        </span>
      </div>

      {/* Present only on a partial or credit sale — it is the debt's due date,
          copied onto the sale (`sale.service.ts:268-272`). */}
      {sale.dueDate ? (
        <div className="flex justify-between gap-4">
          <span className="text-[13px] text-muted-foreground">Due date</span>
          <span className="font-mono text-[13px] text-foreground">
            {formatDate(sale.dueDate, timezone)}
          </span>
        </div>
      ) : null}

      {/*
        `debtId` is present exactly when `amountDue > 0` — the sale and the
        debt are created in one transaction and linked both ways
        (`sale.service.ts:268-272`). The debt carries its own human-readable
        number (`D-000064` in the canvas), which is *not* on this payload, so
        the link says only what it is; naming it would need a second request.
        Hidden from a caller without `debts:view`, whose click would 403.
      */}
      {sale.debtId && canViewDebts ? (
        <Link
          href={ROUTES.debt(sale.debtId)}
          className="mt-1 font-medium text-[13px] text-primary hover:underline print:hidden"
        >
          Open debt
        </Link>
      ) : null}

      {isExchange ? (
        <p className="mt-1 border-border border-t pt-2 text-[11px] text-muted-foreground text-pretty">
          Tendered and change are in {payment.currency}, at the rate frozen on
          this sale. Every other amount is in {currency}.
        </p>
      ) : null}
    </div>
  );
}

/** The receipt's shape while the sale, the currency and the zone land. */
function ReceiptSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-5 w-16" />
      <div className="flex w-full max-w-[720px] flex-col gap-5 rounded-xl border border-border bg-card p-7">
        <div className="flex items-start justify-between gap-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-[38px] w-40" />
        </div>
        <Skeleton className="h-[68px] rounded-[10px]" />
        <Skeleton className="h-[180px] rounded-[10px]" />
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-[92px]" />
          <Skeleton className="h-[140px] rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}
