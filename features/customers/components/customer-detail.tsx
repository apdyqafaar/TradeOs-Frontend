"use client";

import { cn } from "cn";
import {
  ArrowLeft,
  HandCoins,
  Info,
  Pencil,
  Receipt,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { CustomerDebtSummary } from "@/features/customers/components/customer-debt-summary";
import { CustomerFormSheet } from "@/features/customers/components/customer-form-sheet";
import { useCustomer } from "@/features/customers/hooks/use-customer";
import { useArchiveCustomer } from "@/features/customers/hooks/use-customer-mutations";
import type { Customer } from "@/features/customers/types";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { API_ERROR_CODE, type ApiError, hasCode } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/date";

/** Matches `<CustomerTable>`, so a row and its page label a status the same way. */
const STATUS_STYLES: Record<Customer["status"], string> = {
  active: "bg-success-soft text-success-strong",
  archived: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<Customer["status"], string> = {
  active: "Active",
  archived: "Archived",
};

/**
 * The two tabs artboard `2h` draws under the debt panel.
 *
 * Neither has a feature behind it in this slice — see the panels at the bottom
 * of this file — but the tab strip is built for real rather than faked,
 * because Slice 3 fills the panels and nothing else has to change.
 */
const CUSTOMER_TABS = ["debts", "sales"] as const;
type CustomerTab = (typeof CUSTOMER_TABS)[number];

const TAB_LABELS: Record<CustomerTab, string> = {
  debts: "Debts",
  sales: "Sales",
};

const tabParser = parseAsStringLiteral(CUSTOMER_TABS).withDefault("debts");

interface CustomerDetailProps {
  /** From the `[id]` route segment. Never empty — the page awaits `params`. */
  customerId: ObjectId;
}

/**
 * Was this failure "there is no such customer", however it was phrased?
 *
 * Two statuses mean it, and only reading the backend says so:
 *
 * - **404 `NOT_FOUND`** — the row does not exist, *or* it belongs to another
 *   business. `findCustomerById` filters on `organizationId`, so a cross-tenant
 *   id is a 404 rather than a 403 and an id cannot be probed for existence
 *   (`Backend/src/services/customer.service.ts:75-80`).
 * - **422 `VALIDATION_ERROR`** — the id is not 24 hex characters.
 *   `validate({ params: idParamSchema })` runs before the handler and before
 *   `requireAuth`, so `/customers/abc` never reaches the lookup
 *   (`Backend/src/validators/common.validation.ts:5-10`). A GET carries no body
 *   and this route takes no query, so a 422 from it can mean nothing else.
 *
 * Both are the same thing to the reader — they typed or followed a URL that
 * points at no customer — so both get the not-found panel rather than an error
 * card offering to retry a request whose answer will not change.
 */
function isMissingCustomer(error: ApiError | null): boolean {
  if (!error) return false;
  return (
    error.status === 404 ||
    (error.status === 422 && error.code === API_ERROR_CODE.VALIDATION_ERROR)
  );
}

/**
 * One customer: who they are, what they owe, and what may be done about it —
 * artboard `2h`'s lower half, and the plan's Task 9.
 *
 * A client component because everything on it is a query: the customer, the
 * organization's currency and timezone, and the caller's permissions. The
 * page above is a Server Component that does nothing but await the route
 * param.
 */
export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const detail = useCustomer(customerId);
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  const canUpdate = useCan(PERMISSIONS.CUSTOMERS_UPDATE);
  /*
   * `customers:delete` is the archive gate, and the Seller preset does not
   * hold it (`PRESET_SELLER` in `lib/auth/permissions.ts` has view, create and
   * update). A caller without it sees no Archive button at all rather than a
   * disabled one — `CLAUDE.md`'s rule, and the brief's §1.1.
   */
  const canArchive = useCan(PERMISSIONS.CUSTOMERS_DELETE);

  const archive = useArchiveCustomer();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useQueryState("tab", tabParser);

  const { data, error, isPending, refetch } = detail;

  // Nothing failed and nothing is broken: this person may not read customers.
  // `RouteGuard` already gates `/customers/*` on `customers:view`, so arriving
  // here means a role changed under them.
  if (error?.status === 403) {
    return <ForbiddenScreen />;
  }

  if (isMissingCustomer(error)) {
    return (
      <div className="flex flex-col gap-5">
        {/* No `<BackLink>` above this one: the panel's own action is the way
            out, and two identical links to the same list is noise. */}
        <EmptyState
          icon={UserX}
          title="This customer doesn't exist"
          description="The link may be out of date, or the customer may belong to another business."
          action={
            <Button variant="outline" render={<Link href={ROUTES.customers} />}>
              Back to customers
            </Button>
          }
        />
      </div>
    );
  }

  // A failure with nothing cached renders the card alone. Half a detail page
  // under it would read as a customer with no phone and no debts.
  if (error && !data) {
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

  if (isPending || !data) {
    return <CustomerDetailSkeleton />;
  }

  const { customer, debtSummary } = data;
  const isArchived = customer.status === "archived";

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      {/* A refetch failed over rows already on screen: say so, keep them. */}
      {error ? (
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
          title="Couldn't refresh this customer"
        />
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[26px] leading-[1.1] text-foreground">
              {customer.name}
            </h1>
            <span
              className={cn(
                "inline-flex h-[22px] items-center rounded-lg px-2 text-[11px] font-medium",
                STATUS_STYLES[customer.status],
              )}
            >
              {STATUS_LABELS[customer.status]}
            </span>
          </div>

          {/*
            Phone · email on one mono line, as the canvas draws it. The email
            key is absent rather than null when unset (`publicCustomer` copies
            an `undefined`), so the separator has to be conditional or the line
            ends in a dangling middot.
          */}
          <p className="font-mono text-xs text-muted-foreground">
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ""}
          </p>

          {customer.address ? (
            <p className="text-[13px] text-muted-foreground">
              {customer.address}
            </p>
          ) : null}

          {/*
            Held back until the organization has answered. `useOrganization`
            falls back to `"UTC"` while it loads — a real zone, so nothing
            throws — and a date rendered in it would silently shift by a day
            once the business's own zone arrives. A date that changes under the
            reader is worse than one that appears a beat late.
          */}
          {organizationLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <p className="text-xs text-muted-2">
              Customer since {formatDate(customer.createdAt, timezone)}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {canUpdate ? (
              <Button
                variant="outline"
                className="h-9 rounded-[10px] px-3.5 text-[13px]"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
            ) : null}

            {/*
              Nothing to archive twice. An archived customer keeps the banner
              below instead — and reactivating is a `PATCH … { status }` that
              no screen in this slice offers, so no control claims it can.
            */}
            {canArchive && !isArchived ? (
              <ArchiveControl
                confirming={confirmingArchive}
                isPending={archive.isPending}
                onStart={() => {
                  // Clears a refusal from a previous attempt, so the message
                  // beside the button always belongs to the current one.
                  archive.reset();
                  setConfirmingArchive(true);
                }}
                onCancel={() => setConfirmingArchive(false)}
                onConfirm={() =>
                  archive.mutate(customer.id, {
                    onSuccess: () => setConfirmingArchive(false),
                    // A refusal is an answer, not a blip: collapse back to the
                    // single button and let the message explain why. Retrying
                    // the same request would only produce the same 409.
                    onError: () => setConfirmingArchive(false),
                  })
                }
              />
            ) : null}
          </div>

          {archive.error ? <ArchiveError error={archive.error} /> : null}
        </div>
      </header>

      {isArchived ? (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-border-strong bg-surface-2 px-3.5 py-3">
          <Info
            className="mt-px size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-[13px] text-foreground">
            Archived — cannot be sold to on credit.
          </p>
        </div>
      ) : null}

      {/*
        The currency is a second request (`GET /organizations/current/currency`)
        and the amount below is meaningless without it: `formatMoney(76.5, "")`
        renders an unlabelled `76.50`, which on a debt panel is worse than a
        moment more of skeleton.
      */}
      {organizationLoading ? (
        <Skeleton className="h-[94px] rounded-[10px]" />
      ) : (
        <CustomerDebtSummary summary={debtSummary} currency={currency} />
      )}

      {customer.notes ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Notes
          </h2>
          {/* `whitespace-pre-line` because the field is a 2000-character
              textarea and people put a line per thing in it. */}
          <p className="whitespace-pre-line text-[13px] text-foreground">
            {customer.notes}
          </p>
        </section>
      ) : null}

      <div
        role="tablist"
        aria-label="Customer history"
        className="flex gap-6 border-b border-border"
      >
        {CUSTOMER_TABS.map((value) => {
          const isActive = value === tab;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={`customer-tab-${value}`}
              aria-selected={isActive}
              aria-controls={`customer-panel-${value}`}
              onClick={() => void setTab(value, { history: "push" })}
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[value]}
            </button>
          );
        })}
        {/*
          The canvas puts a count beside each label — "Debts 3", "Sales 21".
          Neither is available in this slice and neither is faked here.
          `debtSummary.open` counts *open* debts only, so it is not the number
          of debts this tab would list, and no `/customers` response carries a
          sales count at all. The counts arrive with the lists in Slice 3.
        */}
      </div>

      <div
        role="tabpanel"
        id={`customer-panel-${tab}`}
        aria-labelledby={`customer-tab-${tab}`}
      >
        {tab === "debts" ? (
          /*
           * TODO(slice: 3): replace with this customer's debts, from
           * `GET /debts?customerId=<id>` (`debts:view`, docs/API-ROUTES.md:111;
           * `customerId` is an optional filter on `listDebtsQuerySchema` —
           * Backend/src/validators/debt.validation.ts:19). The endpoint exists
           * today and is deliberately not called: the debts feature slice —
           * types, service, hooks and the row shape — is Slice 3's, and half a
           * debts list built here would be the version Slice 3 has to delete.
           */
          <EmptyState
            icon={HandCoins}
            title="No debts to show yet"
            description="Debts appear here once this customer buys on credit."
          />
        ) : (
          /*
           * TODO(slice: 3): replace with this customer's sales, from
           * `GET /sales?customerId=<id>` (`sales:view`, docs/API-ROUTES.md:205;
           * `customerId` is an optional filter on `listSalesQuerySchema` —
           * Backend/src/validators/sale.validation.ts:23). Same reasoning as
           * the debts panel above.
           */
          <EmptyState
            icon={Receipt}
            title="No sales to show yet"
            description="Sales appear here once this customer buys something."
          />
        )}
      </div>

      {/*
        Edit mode. **`customer` is the object out of React Query's cache** and
        not one rebuilt in this render, which is the sheet's own documented
        requirement: the prop sits in its re-seed effect's dependency list, so a
        fresh identity every render would reset the form under somebody's
        typing. `data.customer` is stable for as long as the query entry is.

        Mounted only for a caller who may submit it, so a Viewer never carries
        the sheet's mutation hooks.
      */}
      {canUpdate ? (
        <CustomerFormSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          customer={customer}
        />
      ) : null}
    </div>
  );
}

/** Back to the list, in the products/customers pages' quiet style. */
function BackLink() {
  return (
    <Link
      href={ROUTES.customers}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Customers
    </Link>
  );
}

interface ArchiveControlProps {
  confirming: boolean;
  isPending: boolean;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Archive, behind one confirmation step.
 *
 * Inline rather than a modal because there is no vendored dialog in
 * `components/ui/` and this slice must not add one; two buttons in the place
 * the first one was is a smaller thing than a new primitive, and it keeps the
 * refusal message (below) beside the control that caused it.
 *
 * The word is **Archive** everywhere, per brief §9 and because that is what
 * `DELETE /customers/:id` actually does — it sets `status: "archived"` and
 * returns the row.
 */
function ArchiveControl({
  confirming,
  isPending,
  onStart,
  onCancel,
  onConfirm,
}: ArchiveControlProps) {
  if (!confirming) {
    return (
      <Button
        variant="outline"
        className="h-9 rounded-[10px] px-3.5 text-[13px]"
        onClick={onStart}
      >
        Archive
      </Button>
    );
  }

  return (
    <>
      <span className="text-[13px] text-muted-foreground">
        Archive this customer?
      </span>
      <Button
        variant="ghost"
        className="h-9 rounded-[10px] px-3 text-[13px]"
        onClick={onCancel}
        disabled={isPending}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        className="h-9 rounded-[10px] px-3.5 text-[13px]"
        onClick={onConfirm}
        disabled={isPending}
      >
        {isPending ? "Archiving…" : "Yes, archive"}
      </Button>
    </>
  );
}

/**
 * Why the archive was refused, inline on the button that was pressed.
 *
 * `CUSTOMER_HAS_OPEN_DEBT` is a 409 raised whenever the customer has any debt
 * in `status: "open"`, whatever the amount
 * (`Backend/src/services/customer.service.ts:25-33`). It gets its own words
 * because the API's message — "This customer has an open debt" — says what is
 * true but not what to do, and because this is the one refusal the reader can
 * actually clear.
 *
 * Not a toast, for the reason the plan gives: a toast leaves the screen while
 * the button that caused it stays, so the same click happens again. Branching
 * on `code` and never on `message`, per `CLAUDE.md`.
 */
function ArchiveError({ error }: { error: ApiError }) {
  const isOpenDebt = hasCode(error, API_ERROR_CODE.CUSTOMER_HAS_OPEN_DEBT);

  return (
    <p
      role="alert"
      className="max-w-[320px] text-right text-xs text-destructive"
    >
      {isOpenDebt
        ? "This customer still owes money. Settle or write off their open debts before archiving them."
        : error.message}
    </p>
  );
}

/**
 * The loading state: the shape of the page, not a spinner in the middle of it.
 *
 * Blocks sized to what replaces them, so the header does not jump when the
 * answer lands.
 */
function CustomerDetailSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-[94px] rounded-[10px]" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
