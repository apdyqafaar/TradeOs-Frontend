"use client";

import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useSession } from "@/features/auth/hooks/use-session";
import type { Customer } from "@/features/customers/types";
import { dueDateFromCalendarDate } from "@/features/debts/schemas/debt.schema";
import { useCurrencyConfig } from "@/features/organization/hooks/use-currency-config";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { CartPane } from "@/features/sales/components/counter/cart-pane";
import { CartTotals } from "@/features/sales/components/counter/cart-totals";
import { CatalogPane } from "@/features/sales/components/counter/catalog-pane";
import {
  type CounterIssues,
  clientIssues,
  isClear,
  serverIssues,
} from "@/features/sales/components/counter/issues";
import { PaymentPanel } from "@/features/sales/components/counter/payment-panel";
import {
  resolveRate,
  tenderOutcome,
} from "@/features/sales/components/counter/tender";
import { useCreateSale } from "@/features/sales/hooks/use-sale-mutations";
import { createSaleSchema } from "@/features/sales/schemas/sale.schema";
import {
  buildSalePayload,
  useCart,
  useCartStore,
} from "@/features/sales/store/cart";
import type { Sale } from "@/features/sales/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate, formatTime } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

/**
 * The counter — artboard `2a`, and the screen this product is for.
 *
 * It composes six pieces and owns four things none of them can: the tender (the
 * currency, the amount, and the customer/due date/note a balance drags in), the
 * refusals, the commit, and what happens afterwards.
 *
 * **No money is computed in this file, or in any component under it.** Line
 * totals, the subtotal and the total come from `features/sales/store/cart.ts`,
 * which is a transcription of the server's own arithmetic tested against its
 * rounding; what a tender does to that total comes from `./tender.ts`, which is
 * a transcription of the same service's next four lines. A cart that disagrees
 * with the receipt by a cent is an argument at the till.
 *
 * **What it refuses to send**, and why each is worth a check rather than a
 * round trip (`./issues.ts` holds the rules, `SALE_ERROR_FIELD` the keys the
 * server answers with):
 *
 *   - an empty cart, an over-discounted line, a discount above the subtotal;
 *   - an empty amount tendered — the field has no server-side default and an
 *     omitted one does **not** mean "paid in full";
 *   - a balance with no customer or no due date, or a due date before today in
 *     the *business's* timezone. The server refuses all three with a 422 keyed
 *     `customerId`/`dueDate`, and re-checks them inside its transaction, so
 *     this is a saved second and never an authority.
 *
 * **What it does not try to predict**: stock (the guarded decrement is the only
 * truth and oversell is impossible server-side), an archived product or
 * customer, and a product that stopped existing mid-shift. Those arrive as 409s
 * and 404s and are routed to the row or the field that names them.
 */
export function Counter() {
  const canCreate = useCan(PERMISSIONS.SALES_CREATE);
  // A credit sale needs a customer, and `CustomerPicker` renders nothing at all
  // without this permission. The whole credit path is gated on it here rather
  // than letting an empty space explain itself.
  const canPickCustomer = useCan(PERMISSIONS.CUSTOMERS_VIEW);
  // `/sales/<id>` inherits the `/sales` row by longest-prefix matching, so a
  // role with `sales:create` and no `sales:view` would be sent to a refusal.
  const canViewReceipt = useCan(PERMISSIONS.SALES_VIEW);

  const { data: session } = useSession();
  const { timezone } = useOrganization();
  const config = useCurrencyConfig();

  const { lines, orderDiscount, totals, issues: cart } = useCart();
  const addProduct = useCartStore((state) => state.addProduct);
  const clearCart = useCartStore((state) => state.clear);
  const createSale = useCreateSale();

  const [currency, setCurrency] = useState("");
  const [tendered, setTendered] = useState<number | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  /** `YYYY-MM-DD` from the date input. The wire wants an instant; see below. */
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<CounterIssues>({});
  const [recorded, setRecorded] = useState<Sale | null>(null);

  // Seeded once the config lands, adjusted during render rather than in an
  // effect. `CurrencyToggle` leaves both radios unchecked for a value matching
  // neither option and will not guess — guessing is how the wrong currency gets
  // recorded (`docs/findings/slice3-money-ui.md`).
  if (currency === "" && config.mainCurrency !== "") {
    setCurrency(config.mainCurrency);
  }

  // `null` for a code the API would refuse. Falling back to `1` for the display
  // would price a KES tender as if it were dollars, so the refusal is carried
  // into the checks below as a blank currency instead.
  const resolved = resolveRate(currency, config);
  const outcome = tenderOutcome({
    total: totals.total,
    // The box is empty until somebody types; the *preview* treats that as
    // nothing tendered, while `clientIssues` still refuses to send it.
    amountTendered: tendered ?? 0,
    rate: resolved ?? 1,
  });

  // Today as the **business** reckons it. The server compares `dueDate`
  // against `startOfDayIn(organization.timezone, now)`, so a browser in London
  // must not decide what "today" means for a shop in Nairobi.
  const today = format(new Date(), "yyyy-MM-dd", { in: tz(timezone) });

  const reset = () => {
    clearCart();
    setTendered(null);
    setCustomer(null);
    setDueDate("");
    setNote("");
    setIssues({});
    // The currency deliberately survives: the till does not change hands
    // between customers, and re-picking it every sale is how a tender ends up
    // recorded in the wrong one.
  };

  const handleClear = () => {
    reset();
    setRecorded(null);
  };

  const handleSubmit = () => {
    const found = clientIssues({
      cart,
      lines,
      // A code that resolves to no rate is as unsendable as a missing one.
      currency: resolved === null ? "" : currency,
      amountTendered: tendered,
      amountDue: outcome.amountDue,
      customerId: customer?.id,
      dueDate,
      today,
      canPickCustomer,
    });

    if (!isClear(found)) {
      setIssues(found);
      return;
    }

    const payload = buildSalePayload(
      { lines, orderDiscount },
      {
        currency,
        // Narrowed by `clientIssues`, which refuses a null tender outright.
        amountTendered: tendered ?? 0,
        ...(customer && { customerId: customer.id }),
        /*
         * Three separate traps, all solved by one helper from `features/debts`
         * — the slice that hit them first, on the same field of the same debt:
         *
         *   1. a bare `2026-09-21` is a 422 (`z.string().datetime()`);
         *   2. `new Date(picked).toISOString()` is midnight **UTC**, which is
         *      before start-of-today for every business west of Greenwich —
         *      a New York shop picking today would be told it is in the past;
         *   3. `TZDate.prototype.toISOString()` emits `…+03:00`, and Zod's
         *      `datetime()` defaults to `offset: false`, so the offset form is
         *      refused exactly as the bare date is.
         *
         * `dueDateFromCalendarDate` builds noon in the business's own zone and
         * serialises it through a plain `Date`, which always writes a `Z`. It
         * is imported rather than copied because a second transcription of a
         * timezone rule is a second one to get wrong.
         *
         * Sent only when the sale actually opens a debt. On a fully-paid sale
         * the server never reads it, and a stale date left in the box from
         * before the cashier typed a larger tender would ride along meaning
         * nothing.
         */
        ...(outcome.amountDue > 0 &&
          dueDate !== "" && {
            dueDate: dueDateFromCalendarDate(dueDate, timezone),
          }),
        note,
      },
    );

    // The schema mirror, after the two checks it cannot make. Everything it
    // catches that `clientIssues` does not is a bound rather than a field —
    // the 100-line ceiling is the realistic one — so it lands on the cart.
    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      setIssues({
        cart: parsed.error.issues[0]?.message ?? "This sale can't be recorded.",
      });
      return;
    }

    setIssues({});
    createSale.mutate(parsed.data, {
      onSuccess: (sale) => {
        setRecorded(sale);
        reset();
      },
      // Routed to the control that names it: a 409's `details` carry the
      // offending `productId`, and a 422's `errors` keys are the only way to
      // tell its five causes apart — they all share `VALIDATION_ERROR`.
      onError: (error) => setIssues(serverIssues(error, lines)),
    });
  };

  // The counter cannot price anything, let alone commit a sale, without the
  // business's currencies — and a price that gains its code a beat after it
  // lands reads as a bug (`CLAUDE.md`, "no hardcoded currency").
  if (config.isLoading) return <CounterSkeleton />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-[32px] text-foreground leading-[1.1]">
          New sale
        </h1>
        <SaleStamp name={session?.user.name} timezone={timezone} />
      </header>

      <div className="flex flex-col overflow-hidden rounded-[12px] border border-border bg-background lg:flex-row">
        <CatalogPane
          currency={config.mainCurrency}
          onAdd={addProduct}
          disabled={createSale.isPending}
          className="border-border border-b p-4 lg:flex-1 lg:border-r lg:border-b-0 lg:p-6"
        />

        <div className="flex w-full flex-none flex-col bg-card lg:w-[480px]">
          {/* Replaced the moment the next product is scanned, which is the
              dismissal a counter actually performs. */}
          {recorded && lines.length === 0 ? (
            <RecordedSale
              sale={recorded}
              mainCurrency={config.mainCurrency}
              canViewReceipt={canViewReceipt}
            />
          ) : null}

          <CartPane
            lines={lines}
            currency={config.mainCurrency}
            lineErrors={issues.lines}
            error={issues.cart}
            onClear={handleClear}
            disabled={createSale.isPending}
          />

          <CartTotals
            totals={totals}
            currency={config.mainCurrency}
            error={issues.orderDiscount}
            disabled={createSale.isPending}
          />

          <PaymentPanel
            currency={currency}
            onCurrencyChange={setCurrency}
            mainCurrency={config.mainCurrency}
            rate={resolved ?? 1}
            tendered={tendered}
            onTenderedChange={setTendered}
            outcome={outcome}
            // The cart's own banner is rendered by `CartPane`, above the lines
            // it is about; repeating it over the submit would say it twice.
            issues={{ ...issues, cart: undefined }}
            credit={{
              customer,
              onCustomerChange: setCustomer,
              dueDate,
              onDueDateChange: setDueDate,
              note,
              onNoteChange: setNote,
            }}
            today={today}
            canCreate={canCreate}
            canPickCustomer={canPickCustomer}
            busy={createSale.isPending}
            onSubmit={handleSubmit}
            // Only a failure nothing could be pinned on reaches the card.
            error={
              createSale.error && isClear(serverIssues(createSale.error, lines))
                ? createSale.error
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The receipt number and what it settled.
 *
 * **The counter does not navigate away on success.** A till is used all day and
 * the next customer is already waiting; sending the cashier to a receipt would
 * make every sale a round trip back. The number is printed instead — it is what
 * a customer quotes — with the receipt one deliberate tap away.
 *
 * That link costs nothing: `useCreateSale` seeds `saleKeys.detail(sale.id)`
 * with the 201 body, which is `publicSale` and byte-identical to what
 * `GET /sales/:id` would answer, so `/sales/<id>` renders from cache without
 * fetching. It is gated on `sales:view` because `/sales/<id>` inherits the
 * `/sales` row by longest-prefix matching, and a role holding `sales:create`
 * without `sales:view` would land on a refusal.
 */
function RecordedSale({
  sale,
  mainCurrency,
  canViewReceipt,
}: {
  sale: Sale;
  mainCurrency: string;
  canViewReceipt: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 border-border border-b bg-success-soft px-5 py-3.5">
      <CheckCircle2
        className="mt-px size-4 flex-none text-success-strong"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium text-[13px] text-success-strong">
          {`Sale ${sale.number} recorded`}
        </p>
        <p className="font-mono text-[12px] text-foreground">
          {formatMoney(sale.total, mainCurrency)}
          {sale.payment.change > 0
            ? // In the TENDERED currency — the customer is handed back what
              // they paid with (`docs/contracts/sales.md` §6, trap 5).
              ` · change ${formatMoney(sale.payment.change, sale.payment.currency)}`
            : ""}
          {sale.payment.amountDue > 0
            ? ` · ${formatMoney(sale.payment.amountDue, mainCurrency)} on credit`
            : ""}
        </p>
      </div>

      {canViewReceipt ? (
        <Link
          href={ROUTES.sale(sale.id)}
          className="flex-none rounded-[6px] font-medium text-[12px] text-primary transition-colors outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Receipt
          <span className="sr-only">{` for sale ${sale.number}`}</span>
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The canvas's `Amina Mohamed · 07 Sep 2026 · 14:32`, in the business's
 * timezone.
 *
 * Mounted-only, and it ticks. A time rendered once at mount is a lie within the
 * minute, and one rendered during SSR is a hydration mismatch — so nothing is
 * drawn until the clock exists on the client.
 */
function SaleStamp({ name, timezone }: { name?: string; timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  return (
    <p className="font-mono text-[12px] text-muted-foreground">
      {[name, formatDate(now, timezone), formatTime(now, timezone)]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/** Both panes at their real proportions, so nothing moves when the answer lands. */
function CounterSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-9 w-44" />
      <div className="flex flex-col gap-4 rounded-[12px] border border-border p-4 lg:flex-row lg:p-6">
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-[52px] rounded-[10px]" />
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
            {["a", "b", "c", "d", "e", "f"].map((cell) => (
              <Skeleton key={cell} className="h-[188px] rounded-[10px]" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[420px] w-full flex-none rounded-[10px] lg:w-[432px]" />
      </div>
    </div>
  );
}
