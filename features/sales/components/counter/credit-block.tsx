"use client";

import { cn } from "cn";
import { useId } from "react";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import type { Customer } from "@/features/customers/types";
import type { CounterIssues } from "@/features/sales/components/counter/issues";

const FIELD =
  "h-12 w-full rounded-[10px] border border-border bg-background px-3 text-[14px] text-foreground transition-colors placeholder:text-muted-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

const CAPTION = "font-medium text-[12px] text-foreground";

export interface CreditBlockProps {
  customer: Customer | null;
  onCustomerChange: (customer: Customer) => void;
  /** `YYYY-MM-DD` straight off the date input — **not** what goes on the wire. */
  dueDate: string;
  onDueDateChange: (calendarDate: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** Today as `YYYY-MM-DD` in the **business's** timezone, not the browser's. */
  today: string;
  /** `useCan(customers:view)`. Without it this path cannot be completed at all. */
  canPickCustomer: boolean;
  issues: Pick<CounterIssues, "customer" | "dueDate">;
  disabled?: boolean;
}

/**
 * The credit block — the heart of artboard `2a`, and the part of this screen
 * with real consequences.
 *
 * It appears the moment a tender leaves a balance, because at that moment the
 * sale stops being a sale and becomes a debt: `POST /sales` creates a `Debt`
 * inside the same transaction and **requires** a customer and a due date to do
 * it, refusing with a 422 keyed `customerId` or `dueDate` otherwise
 * (`sale.service.ts:193-206`, re-checked inside the transaction by
 * `createDebtForSale`). The explanatory line is the canvas's own sentence,
 * because a field that appeared on its own would read as a bug.
 *
 * **The due date is a calendar date here and an instant on the wire**, and the
 * conversion is `dueDateFromCalendarDate`'s, not this component's — see
 * `counter.tsx`, which owns the payload. This box holds `YYYY-MM-DD`, which is
 * both what a native date input produces and what `min` compares against, and
 * which is a **422** if it is ever sent as-is.
 *
 * `min` is today in the *business's* timezone rather than the browser's. The
 * server compares against `startOfDayIn(organization.timezone, now)`, so a shop
 * in Nairobi being offered a London midnight is a picker whose earliest
 * selectable day is refused by the API.
 */
export function CreditBlock({
  customer,
  onCustomerChange,
  dueDate,
  onDueDateChange,
  note,
  onNoteChange,
  today,
  canPickCustomer,
  issues,
  disabled,
}: CreditBlockProps) {
  const uid = useId();
  const dueId = `${uid}-due`;
  const dueErrorId = `${uid}-due-error`;
  const noteId = `${uid}-note`;

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-3.5">
      <p className="text-pretty text-[12px] text-muted-foreground">
        A balance turns this into a debt, so a customer and a due date are
        required.
      </p>

      {/* `CustomerPicker` renders nothing at all without `customers:view` — the
          repo hides controls rather than disabling them — so the reason has to
          be stated here or the block is an unfillable form with nothing in it
          to read (`docs/findings/slice3-money-ui.md`). */}
      {canPickCustomer ? (
        <CustomerPicker
          value={customer}
          onChange={onCustomerChange}
          disabled={disabled}
        />
      ) : null}

      {issues.customer ? (
        <p className="text-[12px] text-destructive-strong">{issues.customer}</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={dueId} className={CAPTION}>
          Due date
        </label>
        <input
          id={dueId}
          type="date"
          value={dueDate}
          // Today in the business's timezone. It stops the picker offering a
          // day the API will refuse; it is not the check — `clientIssues` and
          // then the server both compare again, because `min` is trivially
          // bypassed by typing.
          min={today}
          disabled={disabled}
          aria-invalid={issues.dueDate ? true : undefined}
          aria-describedby={issues.dueDate ? dueErrorId : undefined}
          onChange={(event) => onDueDateChange(event.target.value)}
          className={cn(FIELD, "font-mono")}
        />
        {issues.dueDate ? (
          <p id={dueErrorId} className="text-[12px] text-destructive-strong">
            {issues.dueDate}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className={CAPTION}>
          Note
          <span className="ml-1 font-normal text-muted-2">optional</span>
        </label>
        <input
          id={noteId}
          type="text"
          value={note}
          // The API's own ceiling (`note` is `.max(500)`), so an over-long note
          // cannot be typed rather than being refused after the fact.
          maxLength={500}
          disabled={disabled}
          placeholder="Pays on delivery day"
          onChange={(event) => onNoteChange(event.target.value)}
          className={FIELD}
        />
      </div>
    </div>
  );
}
