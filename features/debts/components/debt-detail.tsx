"use client";

import { cn } from "cn";
import { ArrowLeft, HandCoins, Info } from "lucide-react";
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
import { DebtSummaryCard } from "@/features/debts/components/debt-summary-card";
import { PaymentsTimeline } from "@/features/debts/components/payments-timeline";
import { RecordPaymentDialog } from "@/features/debts/components/record-payment-dialog";
import { WriteOffDialog } from "@/features/debts/components/write-off-dialog";
import { useDebt } from "@/features/debts/hooks/use-debt";
import type { Debt, DebtStatus } from "@/features/debts/types";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";

/**
 * The four **stored** statuses, and the whole of them.
 *
 * There is deliberately no `overdue` key here and it would not compile if
 * anyone tried: `DebtStatus` has no such member, because overdue is never
 * stored. It is a query-filter alias and a pair of response fields, and the
 * badge for it is rendered from `debt.isOverdue` beside this pill.
 */
const STATUS_STYLES: Record<DebtStatus, string> = {
  open: "bg-muted text-muted-foreground",
  paid: "bg-success-soft text-success-strong",
  // A write-off is a loss the business should be able to spot in a list, but
  // it is not an error — amber, not red.
  written_off: "bg-warning-soft text-warning-strong",
  // Nothing happened and nothing is owed: the quietest tone there is.
  cancelled: "bg-muted text-muted-2",
};

const STATUS_LABELS: Record<DebtStatus, string> = {
  open: "Open",
  paid: "Paid",
  written_off: "Written off",
  cancelled: "Cancelled",
};

/**
 * Was this failure "there is no such debt", however it was phrased?
 *
 * Two statuses mean it, and both come from reading the backend rather than
 * guessing — the same pair `customer-detail.tsx` documents:
 *
 * - **404 `NOT_FOUND`** — the row does not exist, *or* it belongs to another
 *   business. `findDebtById` filters on `organizationId`, so a cross-tenant id
 *   is a 404 and an id cannot be probed for existence.
 * - **422 `VALIDATION_ERROR`** — the id is not 24 hex characters.
 *   `validate({ params: idParamSchema })` runs before the handler and even
 *   before `requireAuth`, so `/debts/abc` never reaches the lookup. A GET
 *   carries no body and this route takes no query, so a 422 from it can mean
 *   nothing else.
 *
 * Both are the same thing to the reader — a URL that points at no debt — so
 * neither gets an error card offering to retry a request whose answer will not
 * change.
 */
function isMissingDebt(error: ApiError | null): boolean {
  if (!error) return false;
  return (
    error.status === 404 ||
    (error.status === 422 && error.code === API_ERROR_CODE.VALIDATION_ERROR)
  );
}

export interface DebtDetailProps {
  /** From the `[id]` route segment. Never empty — the page awaits `params`. */
  debtId: ObjectId;
}

/**
 * One debt: who owes it, what is left, what has been paid, and the two things
 * that can be done about it — artboard `2g`
 * (`docs/design/TradeOs-UI.dc.html:874-983`).
 *
 * **This screen prints server fields and computes nothing about money.**
 * `remaining` is a stored column mutated only by guarded atomic updates, and
 * `isOverdue` / `daysOverdue` are recomputed by the API on every single
 * response against its own clock. A browser that subtracted `principal - paid`
 * or compared `dueDate` to `Date.now()` would disagree with the server by a
 * cent or by a day, on the one screen whose entire subject is what a person is
 * owed.
 *
 * **A Debt carries no `currency` field at all**, so every amount is rendered in
 * the organization's main currency from `useOrganization()`, and the summary
 * card is held back behind a skeleton until that has arrived —
 * `formatMoney(167.75, "")` is an unlabelled number on a ledger.
 *
 * The customer is a second request. `publicDebt` emits `customerId` as a bare
 * id string with no name and no phone — there is no `populate` anywhere in the
 * debts backend path — so the header's name, phone and address come from
 * `useCustomer`. One request for one detail page is proportionate; the debts
 * *list* is the screen where per-row joins would not be.
 */
export function DebtDetail({ debtId }: DebtDetailProps) {
  const { data: debt, error, isPending, refetch } = useDebt(debtId);
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  /*
   * `debts:view` does not imply `customers:view` — they are separate rows in
   * the permission catalog, and a custom role can hold one without the other.
   * Passing `undefined` disables the query instead of firing a request that is
   * guaranteed to come back 403; `useCustomer`'s optional id is the escape
   * hatch that makes this expressible without splitting the component in two
   * (the shape `customer-picker.tsx` needed, because `useCustomers` has none).
   */
  const canViewCustomers = useCan(PERMISSIONS.CUSTOMERS_VIEW);
  const customer = useCustomer(canViewCustomers ? debt?.customerId : undefined);

  const canRecordPayment = useCan(PERMISSIONS.PAYMENTS_CREATE);
  const canWriteOff = useCan(PERMISSIONS.DEBTS_WRITE_OFF);

  const [paying, setPaying] = useState(false);
  const [writingOff, setWritingOff] = useState(false);

  // Nothing failed and nothing is broken: this person may not read debts.
  // `RouteGuard` already gates `/debts/*` on `debts:view` through the `/debts`
  // prefix, so arriving here means a role changed under them.
  if (error?.status === 403) return <ForbiddenScreen />;

  if (isMissingDebt(error)) {
    return (
      <EmptyState
        icon={HandCoins}
        title="This debt isn't here"
        description="The link may be out of date, or the debt may belong to another business."
      />
    );
  }

  // A failure with nothing cached renders the card alone. Half a detail page
  // under it would read as a debt with no balance.
  if (error && !debt) {
    return (
      <ErrorCard
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }

  if (isPending || !debt) return <DebtDetailSkeleton />;

  /*
   * Hidden rather than disabled, and hidden for two different reasons that
   * happen to land on the same control (CLAUDE.md, brief §1.1):
   *
   *   - **permission** — `payments:create` and `debts:write_off` are separate
   *     grants, and the Seller preset holds the first without the second;
   *   - **state** — both endpoints refuse a debt that is not `open` with 409
   *     `DEBT_NOT_OPEN`, and the write-off additionally needs `remaining > 0`
   *     (`debt.actions.ts:126-127`). A button whose every press is a
   *     guaranteed 409 is worse than no button.
   */
  const isOpen = debt.status === "open";
  const showRecordPayment = canRecordPayment && isOpen;
  const showWriteOff = canWriteOff && isOpen && debt.remaining > 0;

  /**
   * The balance on screen is no longer trustworthy — go and ask the server.
   *
   * Only the **debt** is refetched, not the payments list: the balance is what
   * the refusals in the dialogs are about, and the competing payment that won
   * a race is not this screen's own write. The timeline refreshes itself
   * whenever one of its own mutations lands.
   */
  const refresh = () => {
    void refetch();
  };

  return (
    <div className="flex flex-col gap-5">
      {/*
        A real link now: `app/(app)/debts/page.tsx` exists, so `ROUTES.debts`
        is no longer a 404 dressed as navigation. In the quiet style
        `customer-detail.tsx` and `receipt.tsx` use for the same job.
      */}
      <Link
        href={ROUTES.debts}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Debts
      </Link>

      {/* A refetch failed over a debt already on screen: say so, keep it. */}
      {error ? (
        <ErrorCard
          error={error}
          title="Couldn't refresh this debt"
          retry={refresh}
        />
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <CustomerHeading
            customerId={debt.customerId}
            name={customer.data?.customer.name}
            phone={customer.data?.customer.phone}
            address={customer.data?.customer.address}
            isPending={canViewCustomers && customer.isPending}
          />

          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-lg px-2.5 font-medium text-[12px]",
                STATUS_STYLES[debt.status],
              )}
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-current"
              />
              {STATUS_LABELS[debt.status]}
            </span>

            {/*
              `isOverdue` and `daysOverdue` are computed by the server on every
              response — `status === "open" && dueDate < now && remaining > 0`,
              against the API's clock. `debt.status === "overdue"` matches
              nothing, ever, and would not even compile against `DebtStatus`.
            */}
            {debt.isOverdue ? (
              <span className="inline-flex h-5 items-center rounded-md bg-destructive-soft px-1.5 font-medium font-mono text-[10px] text-destructive-strong">
                {debt.daysOverdue} d overdue
              </span>
            ) : null}

            <DebtSource debt={debt} />

            {/*
              Held back until the organization has answered. `useOrganization`
              falls back to `"UTC"` while it loads — a real zone, so nothing
              throws — and a due date rendered in it can be a day out once the
              business's own zone arrives. A date that shifts under the reader
              is worse than one that appears a beat late.
            */}
            {organizationLoading ? (
              <Skeleton className="h-4 w-28" />
            ) : (
              <span className="font-mono text-[12px] text-muted-foreground">
                due {formatDate(debt.dueDate, timezone)}
              </span>
            )}
          </div>

          {debt.description ? (
            <p className="mt-1 max-w-prose text-[13px] text-muted-foreground">
              {debt.description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {showRecordPayment ? (
            <Button
              className="h-[38px] rounded-[10px] px-3.5 text-[13px]"
              onClick={() => setPaying(true)}
            >
              Record payment
            </Button>
          ) : null}
          {showWriteOff ? (
            <Button
              variant="outline"
              className="h-[38px] rounded-[10px] px-3.5 text-[13px] text-muted-foreground"
              onClick={() => setWritingOff(true)}
            >
              Write off
            </Button>
          ) : null}
        </div>
      </header>

      {debt.status === "written_off" ? (
        <ClosedNote>
          Written off
          {debt.writtenOffAt && !organizationLoading
            ? ` on ${formatDate(debt.writtenOffAt, timezone)}`
            : ""}
          {debt.writeOffReason ? ` — ${debt.writeOffReason}` : ""}.
          {/* `writtenOffAmount` is the balance at that instant, not the
              principal, and it is already on the summary card below. */}
        </ClosedNote>
      ) : null}

      {debt.cancelledAt ? (
        <ClosedNote>
          Cancelled
          {organizationLoading
            ? ""
            : ` on ${formatDate(debt.cancelledAt, timezone)}`}
          . Nothing further is owed on it.
        </ClosedNote>
      ) : null}

      {/*
        The currency is a second request and all four figures are meaningless
        without it: `formatMoney(167.75, "")` renders an unlabelled number,
        which on a debt is worse than a moment more of skeleton.
      */}
      {organizationLoading ? (
        <Skeleton className="h-[132px] rounded-[10px]" />
      ) : (
        <DebtSummaryCard debt={debt} currency={currency} />
      )}

      <PaymentsTimeline debtId={debt.id} debtStatus={debt.status} />

      {/*
        Mounted only for a caller who may submit them, so a Viewer never
        carries either dialog's mutation hooks — and neither can be opened by
        a state flag that outlived a permission change.
      */}
      {showRecordPayment ? (
        <RecordPaymentDialog
          open={paying}
          onOpenChange={setPaying}
          debt={debt}
          onStale={refresh}
        />
      ) : null}

      {showWriteOff ? (
        <WriteOffDialog
          open={writingOff}
          onOpenChange={setWritingOff}
          debt={debt}
          currency={currency}
          onStale={refresh}
        />
      ) : null}
    </div>
  );
}

interface CustomerHeadingProps {
  customerId: ObjectId;
  name?: string;
  phone?: string;
  address?: string;
  isPending: boolean;
}

/**
 * The canvas's name / phone · address block.
 *
 * All three come from `GET /customers/:id`, which can be unavailable for two
 * ordinary reasons — the caller lacks `customers:view`, or the request has not
 * landed. Neither is an error worth a panel on a debt screen, and **no part of
 * it is invented**: without a name the heading says what the page is and the
 * id is shown in mono, which is traceable rather than fictional.
 */
function CustomerHeading({
  customerId,
  name,
  phone,
  address,
  isPending,
}: CustomerHeadingProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  if (!name) {
    return (
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.1] text-foreground">
          Debt
        </h1>
        <p className="font-mono text-xs text-muted-2">Customer {customerId}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-serif text-[28px] leading-[1.1] text-foreground">
        {/* The second way out of this screen, beside the back link: the
            customer's own page is where the rest of what they owe lives. */}
        <Link
          href={ROUTES.customer(customerId)}
          className="rounded-[6px] transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {name}
        </Link>
      </h1>
      {/* Phone · address on one mono line, as the canvas draws it. `address`
          is absent rather than null when unset, so the separator has to be
          conditional or the line ends in a dangling middot. */}
      <p className="font-mono text-xs text-muted-foreground">
        {phone}
        {address ? ` · ${address}` : ""}
      </p>
    </div>
  );
}

/**
 * Where the debt came from.
 *
 * A sale-born debt carries a `saleId` and the canvas draws it as a link to the
 * receipt. `/sales/[id]` does not exist yet, so this is plain text with the id
 * in its `title` — `stock-movements-table.tsx` made the same call for the same
 * reason. The id is shortened because a debt carries the sale's ObjectId and
 * not its receipt number; nothing in this payload knows what the counter
 * printed.
 */
function DebtSource({ debt }: { debt: Debt }) {
  if (debt.source !== "sale" || !debt.saleId) {
    return (
      <span className="font-mono text-[12px] text-muted-2">Manual debt</span>
    );
  }

  // The label is the sale's id, not its receipt number: nothing in this
  // payload carries what the counter printed, so the last six characters are
  // the most honest short handle available, with the whole id in `title`.
  return (
    <Link
      href={ROUTES.sale(debt.saleId)}
      className="font-mono text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title={`Sale ${debt.saleId}`}
    >
      Sale …{debt.saleId.slice(-6)}
    </Link>
  );
}

/** The quiet banner a closed debt carries, in `customer-detail.tsx`'s style. */
function ClosedNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-border-strong bg-surface-2 px-3.5 py-3">
      <Info
        className="mt-px size-4 flex-none text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-[13px] text-foreground">{children}</p>
    </div>
  );
}

/**
 * The loading state: the shape of the page, not a spinner in the middle of it.
 * Blocks sized to what replaces them, so the header does not jump when the
 * answer lands.
 */
function DebtDetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-[38px] w-56" />
      </div>
      <Skeleton className="h-[132px] rounded-[10px]" />
      <Skeleton className="h-40 rounded-[10px]" />
    </div>
  );
}
