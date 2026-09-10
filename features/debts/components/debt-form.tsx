"use client";

import { tz } from "@date-fns/tz";
import { cn } from "cn";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ButtonLink } from "@/components/shared/button-link";
import { MoneyInput } from "@/components/shared/money-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import type { Customer } from "@/features/customers/types";
import { useCreateDebt } from "@/features/debts/hooks/use-debt-mutations";
import {
  type CreateDebtInput,
  createDebtSchema,
  dueDateFromCalendarDate,
} from "@/features/debts/schemas/debt.schema";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import {
  API_ERROR_CODE,
  type ApiError,
  fieldErrorsFor,
} from "@/lib/api/errors";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * What a native date input can hand back — and the only shape
 * `dueDateFromCalendarDate` accepts; it throws a `RangeError` on anything else.
 *
 * Not a theoretical guard. `<input type="date">` degrades to a plain text box
 * in a browser without date support, and there the field can hold "next
 * Friday". Testing before converting is what keeps that a field error instead
 * of an exception thrown out of an event handler.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FIELD =
  "w-full rounded-[10px] border border-border bg-background px-3 text-[14px] text-foreground transition-colors placeholder:text-muted-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/** Every refusal this screen can show, addressed to the control that can fix it. */
interface Issues {
  customer?: string;
  amount?: string;
  dueDate?: string;
  description?: string;
  /** A refusal with no field to fix. Rendered inline above the actions. */
  form?: string;
}

/**
 * Which control a 422's `errors` key belongs to.
 *
 * `satisfies Record<keyof CreateDebtInput, keyof Issues>` is the point of the
 * whole constant: it is a **compile-time** assertion that this form routes every
 * key the body actually has, and only those. If the wire shape ever drifted —
 * `amount` becoming `principal`, say, which is the single mistake
 * `debt.schema.ts` warns hardest about — this stops compiling rather than
 * silently dropping the server's message about the field nobody renders.
 */
const ISSUE_FOR_FIELD = {
  customerId: "customer",
  amount: "amount",
  dueDate: "dueDate",
  description: "description",
} as const satisfies Record<keyof CreateDebtInput, keyof Issues>;

/**
 * Record a debt by hand — `POST /debts`, gated on `debts:create`.
 *
 * **Not every debt comes from a sale.** A credit sale raises its own debt
 * inside `POST /sales`' transaction; this is the other door — stock lent on
 * credit, or a balance carried forward from before this business used TradeOs.
 * The endpoint only ever creates `source: "manual"` debts, which is why
 * `description` is required here even though the model makes it conditional
 * (`debt.validation.ts:9`, and the note on `createDebtSchema`).
 *
 * **Three fields, and every one of them is a trap the schema documents:**
 *
 *   1. The amount is sent as **`amount`**, never `principal`. `principal` is
 *      server-set to `round2(amount)` (`debt.service.ts:65`) and the body is
 *      `.strict()`, so a `principal` key is a 422. `ISSUE_FOR_FIELD` above
 *      makes that a compile error rather than a runtime one.
 *   2. The due date is a **calendar date in this box and an instant on the
 *      wire**, converted by `dueDateFromCalendarDate` — imported, never
 *      re-derived. See the long comment there for the three separate ways the
 *      obvious conversion fails.
 *   3. The amount carries **no currency choice**, unlike a payment. A `Debt`
 *      has no currency field at all (`debt.model.ts:16-35`), so every figure on
 *      it is implicitly the organization's main currency — offering a toggle
 *      would imply a choice the record cannot hold.
 *
 * State is `useState` plus one `safeParse`, the shape `record-payment-dialog`
 * uses, rather than react-hook-form. Two of the three controls — `MoneyInput`
 * and `CustomerPicker` — are controlled components holding a `number | null`
 * and a whole `Customer`, so neither can be `register`ed; a resolver would end
 * up validating two `setValue`-shadowed fields, which is the form library doing
 * none of its job at twice the indirection.
 *
 * Nothing here is a toast. A refusal lands under the control that caused it
 * (brief §8.4), and the one refusal that has no field — a 403 from a role that
 * changed mid-session — gets the inline panel above the buttons.
 */
export function DebtForm() {
  const uid = useId();
  const router = useRouter();
  const create = useCreateDebt();

  /*
   * Both facts, and neither has a safe default. `currency` labels the amount —
   * a code, never a symbol — and `timezone` is the zone the due date is built
   * in and compared against. `useOrganization` falls back to `""` and `"UTC"`
   * while it loads, which is why the submit waits for `isLoading` below: a
   * `dueDate` built in UTC for a shop in New York can name the wrong day, and
   * that is a wrong write rather than a cosmetic one.
   */
  const {
    currency,
    timezone,
    isLoading: organizationLoading,
  } = useOrganization();

  /*
   * `CustomerPicker` renders nothing at all without `customers:view` — the
   * repo hides controls rather than disabling them — so this form has to state
   * the reason itself or it is an uncompletable page with nothing on it to
   * read. The same call `credit-block.tsx` makes for the counter's credit path.
   */
  const canPickCustomer = useCan(PERMISSIONS.CUSTOMERS_VIEW);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  /** `YYYY-MM-DD` straight off the date input — **not** what goes on the wire. */
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [issues, setIssues] = useState<Issues>({});

  const busy = create.isPending;

  /**
   * Drop one control's message, leaving the others standing.
   *
   * A refusal about a value the reader has already changed is noise — but
   * clearing the whole object on every keystroke, which is what a dialog with
   * one field can afford to do, would hide the two fields they have not got to
   * yet the moment they touch the third.
   */
  const clear = (slot: keyof Issues) =>
    setIssues((current) => ({ ...current, [slot]: undefined }));

  /*
   * Today as the **business** reckons it, not the browser. The server compares
   * `dueDate` against `startOfDayIn(organization.timezone, now)`
   * (`debt.service.ts:55-59`), so a laptop in London must not decide what
   * "today" means for a shop in Nairobi. Held back until the organization
   * lands, because the `"UTC"` fallback would offer or refuse a day the API
   * would not.
   */
  const today = organizationLoading
    ? undefined
    : format(new Date(), "yyyy-MM-dd", { in: tz(timezone) });

  const failed = (error: ApiError) => {
    const next: Issues = {};
    let handled = false;

    /*
     * A 422 arrives with its own field map, and this endpoint's most likely one
     * is exactly that shape: the due-date-before-today refusal is raised with
     * `{ dueDate }` (`debt.service.ts:55-59`), so it lands on the date box
     * unaided. Nothing client-side knows that boundary — the server's `now` is
     * the only authority on it — which is why the check below saves a round
     * trip without ever being the last word.
     */
    for (const [field, message] of Object.entries(fieldErrorsFor(error))) {
      const slot = ISSUE_FOR_FIELD[field as keyof typeof ISSUE_FOR_FIELD];
      if (slot) {
        next[slot] = message;
        handled = true;
      }
    }

    // Branch on `code`, never on `message` (CLAUDE.md).
    if (error.code === API_ERROR_CODE.CUSTOMER_ARCHIVED) {
      /*
       * A real refusal with a real cause: an archived customer cannot take on
       * new credit (`debt.service.ts:48-50`). It belongs at the picker because
       * choosing somebody else is the only fix — there is no unarchive endpoint
       * in this phase, and `DELETE /customers/:id` is what archives one.
       *
       * Reachable even though the picker searches `status: "active"`: the
       * customer was archived between the search and this submit.
       */
      next.customer =
        "That customer has been archived, so they can't take on new credit. Pick someone else.";
      handled = true;
    }

    /*
     * Everything else, including a 404 and a 403. The 404 is deliberately left
     * as the API's own sentence in the panel rather than pinned to the picker:
     * `createManualDebt` raises `NOT_FOUND` for a missing customer
     * (`debt.service.ts:47`) *and* for a missing organization (`:53`), with the
     * same code and nothing to tell them apart, so claiming "that customer is
     * gone" would be a guess. Its message already names which.
     */
    if (!handled) next.form = error.message;

    setIssues(next);
  };

  const submit = () => {
    const next: Issues = {};

    if (customer === null) {
      next.customer = canPickCustomer
        ? "Choose the customer who owes this."
        : "A debt is owed by somebody, so this form needs a customer. Your role can't look customers up — ask a manager to record this one.";
    }

    if (dueDate === "") {
      next.dueDate = "Set the day this is due.";
    } else if (!CALENDAR_DATE.test(dueDate)) {
      next.dueDate = "Use a date like 2026-09-30.";
    } else if (today !== undefined && dueDate < today) {
      // String comparison is safe on `YYYY-MM-DD`, and both sides are already
      // resolved in the business's timezone — the zone the server compares in
      // too. A copy of the server's rule to save a round trip, never the
      // authority: its `now` moves and this one does not.
      next.dueDate = "The due date can't be before today.";
    }

    /*
     * The payload is assembled and handed to `createDebtSchema` whole rather
     * than checked field by field, so the browser refuses exactly what the
     * backend validator refuses and one file knows the bounds. The pre-checks
     * above run first and keep their slot (`??=` below), because zod's message
     * for a missing customer is "Not a valid id" — true, and not a sentence to
     * put in front of somebody who simply has not picked one yet.
     */
    const parsed = createDebtSchema.safeParse({
      customerId: customer?.id ?? "",
      amount,
      dueDate: CALENDAR_DATE.test(dueDate)
        ? dueDateFromCalendarDate(dueDate, timezone)
        : "",
      description,
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const slot =
          ISSUE_FOR_FIELD[issue.path[0] as keyof typeof ISSUE_FOR_FIELD];
        if (slot) next[slot] ??= issue.message;
        else next.form ??= issue.message;
      }
      setIssues(next);
      return;
    }

    if (Object.keys(next).length > 0) {
      setIssues(next);
      return;
    }

    setIssues({});
    create.mutate(parsed.data, {
      // The thing just created, not the list it joined — the same call
      // `product-form.tsx` documents. `useCreateDebt` seeds
      // `debtKeys.detail(id)` from the create response (`publicDebt` shapes
      // both `POST /debts` and `GET /debts/:id`), so the detail page arrives
      // with data and never flashes a skeleton.
      onSuccess: (debt) => router.push(ROUTES.debt(debt.id)),
      onError: failed,
    });
  };

  const errorLine = (slot: keyof Issues) =>
    issues[slot] ? (
      <p
        id={`${uid}-${slot}-error`}
        role="alert"
        className="text-[12px] text-destructive-strong"
      >
        {issues[slot]}
      </p>
    ) : null;

  return (
    // `noValidate`: the browser's own bubble on the date field would preempt
    // the messages below, and the reader would never see this form's own.
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex max-w-[560px] flex-col gap-5"
    >
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          {canPickCustomer ? (
            <CustomerPicker
              value={customer}
              onChange={(picked) => {
                setCustomer(picked);
                clear("customer");
              }}
              disabled={busy}
            />
          ) : null}
          {errorLine("customer")}
        </div>

        <div className="flex flex-col gap-1.5">
          <MoneyInput
            id={`${uid}-amount`}
            label="Amount"
            value={amount}
            onChange={(value) => {
              setAmount(value);
              clear("amount");
            }}
            /*
             * The books' currency, and the only one this record can be in —
             * so no `mainCurrency` / `exchangeRate` pair and no converted
             * line. There is no `max` either: unlike a payment, a new debt has
             * no balance to fit inside.
             */
            currency={currency}
            disabled={busy || organizationLoading}
            placeholder="0.00"
          />
          {/*
            `MoneyInput` prints the code only to screen readers, because every
            screen that uses it elsewhere has a currency toggle overhead saying
            which. This one has no toggle — a Debt carries no currency of its
            own — so the sentence that would otherwise be missing is here, with
            the code and never a symbol (`lib/format/money.ts`).
          */}
          <p className="text-[12px] text-muted-foreground">
            {organizationLoading
              ? "Loading the business's main currency…"
              : `Recorded in ${currency}, this business's main currency. A debt has no currency of its own.`}
          </p>
          {errorLine("amount")}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-dueDate`} className="text-[13px]">
            Due date
          </Label>
          <input
            id={`${uid}-dueDate`}
            type="date"
            value={dueDate}
            // Today in the business's timezone. It stops the picker offering a
            // day the API will refuse; it is not the check — `submit` and then
            // the server both compare again, because `min` is trivially
            // bypassed by typing.
            min={today}
            disabled={busy || organizationLoading}
            aria-invalid={issues.dueDate ? true : undefined}
            aria-describedby={
              issues.dueDate ? `${uid}-dueDate-error` : undefined
            }
            onChange={(event) => {
              setDueDate(event.target.value);
              clear("dueDate");
            }}
            className={cn(FIELD, "h-12 font-mono")}
          />
          {errorLine("dueDate")}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-description`} className="text-[13px]">
            What this is for
          </Label>
          <textarea
            id={`${uid}-description`}
            rows={3}
            value={description}
            // The API's own ceiling (`.max(500)`), so an over-long description
            // cannot be typed rather than being refused after the fact.
            maxLength={500}
            disabled={busy}
            placeholder="Two sacks of maize taken on credit"
            aria-invalid={issues.description ? true : undefined}
            // An id list, not a class list — `cn` would run it through
            // tailwind-merge, which is not a thing to hand identifiers to.
            aria-describedby={[
              `${uid}-description-hint`,
              issues.description ? `${uid}-description-error` : null,
            ]
              .filter((part): part is string => part !== null)
              .join(" ")}
            onChange={(event) => {
              setDescription(event.target.value);
              clear("description");
            }}
            className={cn(FIELD, "py-2.5 leading-relaxed")}
          />
          <p
            id={`${uid}-description-hint`}
            className="text-[12px] text-muted-foreground"
          >
            {/* Required, and not by this form's choice: `POST /debts` only
                creates manual debts and its validator requires a description
                unconditionally (`debt.validation.ts:9`). */}
            Required. This is the only record of what was handed over — a debt
            raised by hand has no sale behind it to look up.
          </p>
          {errorLine("description")}
        </div>
      </section>

      {issues.form ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-3 text-[13px] text-destructive-strong"
        >
          {issues.form}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2.5">
        <ButtonLink
          variant="outline"
          className="h-10 rounded-[10px] px-4 text-[13px]"
          href={ROUTES.debts}
        >
          Cancel
        </ButtonLink>
        <Button
          type="submit"
          // Held until the organization lands: the amount has no currency to be
          // in and the due date has no timezone to be built in until it does.
          disabled={busy || organizationLoading}
          className="h-10 rounded-[10px] px-4 font-semibold text-[13px]"
        >
          {busy ? "Saving…" : "Save debt"}
        </Button>
      </div>
    </form>
  );
}
