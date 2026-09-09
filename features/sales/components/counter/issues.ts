import { SALE_ERROR_FIELD } from "@/features/sales/schemas/sale.schema";
import type { CartIssues, CartLine } from "@/features/sales/store/cart";
import { API_ERROR_CODE, fieldErrorsFor, isApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { formatQuantity } from "@/lib/format/money";

/**
 * Every refusal the counter can show, addressed to the control that can fix it.
 *
 * One flat object rather than a `setError` call per field, because two of the
 * five keys a `POST /sales` 422 can carry name a **computed** value rather than
 * something the cashier typed: `items` reports a line's discount exceeding its
 * own total and `discount` reports the order-level one exceeding the subtotal
 * (`features/sales/schemas/sale.schema.ts`, `SALE_ERROR_FIELD`). A blind loop
 * over `fieldErrors` into a form drops both on the floor.
 *
 * Filled from two sources that must produce the same shape: `clientIssues`,
 * before anything is sent, and `serverIssues`, from the answer when something
 * was sent anyway. The server re-checks every rule inside its transaction, so
 * the client's copy saves a round trip and is never an authority.
 */
export interface CounterIssues {
  /** A refusal with no field to fix — an archived product, a vanished id. */
  cart?: string;
  /** Keyed by `productId`: the message belongs on that cart line, not in a toast. */
  lines?: Record<ObjectId, string>;
  orderDiscount?: string;
  currency?: string;
  tendered?: string;
  customer?: string;
  dueDate?: string;
}

/** True when nothing was refused — the caller may post, or must fall back to a card. */
export const isClear = (issues: CounterIssues): boolean =>
  Object.keys(issues).length === 0;

export interface ClientCheck {
  /** `cartIssues(...)` from the store — the two rules a schema mirror cannot see. */
  cart: CartIssues;
  lines: CartLine[];
  /** The tendered ISO code, `""` while `useCurrencyConfig` is still loading. */
  currency: string;
  /** `null` for an empty amount box — which is not the same as `0`. */
  amountTendered: number | null;
  /** `tenderOutcome(...).amountDue`, in main currency. */
  amountDue: number;
  customerId?: ObjectId;
  /** `YYYY-MM-DD` from the date input, `""` when unset. */
  dueDate: string;
  /** Today as `YYYY-MM-DD` **in the business's timezone**, not the browser's. */
  today: string;
  /** `useCan(customers:view)` — without it the credit path cannot be completed at all. */
  canPickCustomer: boolean;
}

/**
 * What the counter refuses before spending a round trip.
 *
 * Each of these is a 422 whose answer is already on screen, so asking the
 * server would cost a second and tell the cashier nothing new. The rules the
 * counter deliberately does **not** predict are stock (the guarded decrement is
 * the only truth), whether the customer is archived, and whether a product
 * still exists — all three are races the server owns.
 */
export function clientIssues(check: ClientCheck): CounterIssues {
  const issues: CounterIssues = {};

  if (check.cart.isEmpty) {
    issues.cart = "Ring something up before completing the sale.";
  }

  if (check.cart.negativeLines.length > 0) {
    // Every offending line at once. The server names only the first one it
    // meets, which turns a two-line mistake into two round trips.
    issues.lines = Object.fromEntries(
      check.cart.negativeLines.map((productId) => [
        productId,
        "This discount is more than the line is worth.",
      ]),
    );
  }

  if (check.cart.orderDiscountExceedsSubtotal) {
    issues.orderDiscount = "The sale discount is more than the subtotal.";
  }

  if (check.currency === "") {
    // `payment.currency` has no default and no safe guess. Posting a blank one
    // is a 422; posting a hardcoded "USD" over a Kenyan shop's takings is worse.
    issues.currency = "The business's currencies haven't loaded yet.";
  }

  if (check.amountTendered === null) {
    // `amountTendered` has no default on the server and an omitted one does
    // NOT mean "paid in full" (`docs/contracts/sales.md` trap 7). An empty box
    // is not zero either: a cashier who has typed nothing has not yet said
    // this is a sale entirely on credit.
    issues.tendered =
      "Enter the amount tendered. Type 0 for a sale entirely on credit.";
  }

  // Guarded on the tender, not only on the balance. Before an amount is typed
  // every sale technically owes its whole total, and telling a cashier to pick
  // a customer for a bill nobody has paid yet is an answer to a question they
  // have not asked — the tender message above is the one thing to fix first.
  if (check.amountTendered !== null && check.amountDue > 0) {
    if (!check.canPickCustomer) {
      // `CustomerPicker` renders nothing at all without `customers:view`, by
      // the repo's hide-don't-disable rule — so the explanation has to be here
      // or the form is uncompletable with nothing in it to read.
      issues.customer =
        "A balance becomes a debt, which needs a customer. Your role can't look customers up, so take the full amount or ask a manager to record this sale.";
    } else if (check.customerId === undefined) {
      issues.customer = "Choose the customer who owes this balance.";
    }

    if (check.dueDate === "") {
      issues.dueDate = "Set the day this balance is due.";
    } else if (check.dueDate < check.today) {
      // String comparison is safe on `YYYY-MM-DD`, and both sides are already
      // resolved in the business's timezone — the zone the server compares in
      // too (`sale.service.ts:200-205`).
      issues.dueDate = "The due date can't be before today.";
    }
  }

  return issues;
}

/** Reads one number out of an error's untyped `details` bag. */
const numberFrom = (
  details: Record<string, unknown> | undefined,
  key: string,
): number | null => {
  const value = details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * The server's answer, routed to the same controls `clientIssues` uses.
 *
 * Returns an **empty** object for anything it does not recognise — a 500, a
 * dead network, a 403 from a role that changed mid-shift — so the caller can
 * tell "shown inline" from "needs an error card with the request id in it".
 *
 * `lines` is passed in because the most useful message needs the cart to be
 * readable at all: a 409's `details` carry a bare `productId` and bare numbers,
 * and a quantity without its unit ("only 4 left" of what — kilos? cartons?) is
 * the sentence that sends someone to count the wrong shelf.
 */
export function serverIssues(error: unknown, lines: CartLine[]): CounterIssues {
  if (!isApiError(error)) return {};

  if (error.code === API_ERROR_CODE.INSUFFICIENT_STOCK) {
    const productId = error.details?.productId;
    const requested = numberFrom(error.details, "requested");
    const available = numberFrom(error.details, "available");
    const line =
      typeof productId === "string"
        ? lines.find((row) => row.productId === productId)
        : undefined;

    if (line && requested !== null && available !== null) {
      return {
        lines: {
          [line.productId]: `Only ${formatQuantity(available, line.unit)} in stock, and this line asks for ${formatQuantity(requested, line.unit)}.`,
        },
      };
    }
    // The shape changed, or the offending product is not in this cart. The
    // API's own sentence is still true, so it is shown rather than swallowed.
    return { cart: error.message };
  }

  // `PRODUCT_ARCHIVED` names the product in its message and carries no
  // `details`, so there is no line to hang it on (`sale.service.ts:150-152`).
  if (error.code === API_ERROR_CODE.PRODUCT_ARCHIVED) {
    return { cart: error.message };
  }

  if (error.code === API_ERROR_CODE.CUSTOMER_ARCHIVED) {
    return { customer: error.message };
  }

  // A well-formed id that resolves to nothing, including one belonging to
  // another business — the two are deliberately indistinguishable. Either a
  // product was deleted mid-shift or the chosen customer was.
  if (error.status === 404) {
    return { cart: error.message };
  }

  if (error.status !== 422) return {};

  const fields = fieldErrorsFor(error);
  const issues: CounterIssues = {};
  const unrouted: string[] = [];

  for (const [field, message] of Object.entries(fields)) {
    switch (field) {
      case SALE_ERROR_FIELD.CUSTOMER:
        issues.customer = message;
        break;
      case SALE_ERROR_FIELD.DUE_DATE:
        issues.dueDate = message;
        break;
      case SALE_ERROR_FIELD.CURRENCY:
        issues.currency = message;
        break;
      case SALE_ERROR_FIELD.DISCOUNT:
        issues.orderDiscount = message;
        break;
      case SALE_ERROR_FIELD.ITEMS:
        // The service's own line-level refusal. It names the product in the
        // message but sends no index, so it cannot be placed on a row.
        issues.cart = message;
        break;
      case "payment.amountTendered":
        issues.tendered = message;
        break;
      default: {
        // Zod's per-line keys, e.g. `items.0.quantity` — these DO carry an
        // index, so they land on the row the cashier has to fix.
        const indexed = /^items\.(\d+)\./.exec(field);
        const line = indexed ? lines[Number(indexed[1])] : undefined;
        if (line) {
          issues.lines = { ...issues.lines, [line.productId]: message };
        } else {
          unrouted.push(message);
        }
      }
    }
  }

  if (unrouted.length > 0) {
    issues.cart = [issues.cart, ...unrouted].filter(Boolean).join(" ");
  }

  // A 422 whose `errors` map was empty still has to say something, or the
  // submit silently does nothing.
  return isClear(issues) ? { cart: error.message } : issues;
}
