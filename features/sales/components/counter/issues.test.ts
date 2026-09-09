import { describe, expect, it } from "vitest";
import {
  type ClientCheck,
  clientIssues,
  serverIssues,
} from "@/features/sales/components/counter/issues";
import { type CartLine, cartIssues } from "@/features/sales/store/cart";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";

const rice: CartLine = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Basmati rice",
  unit: "kg",
  listPrice: 4.5,
  unitPrice: 4.5,
  quantity: 2,
  discount: 0,
};

const oil: CartLine = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaa2",
  name: "Cooking oil",
  unit: "L",
  listPrice: 12,
  unitPrice: 12,
  quantity: 1,
  discount: 0,
};

/** A cart that is fine, paid in full, in the shop's own currency. */
const clean = (over: Partial<ClientCheck> = {}): ClientCheck => {
  const lines = over.lines ?? [rice, oil];
  const orderDiscount = 0;
  return {
    cart: cartIssues({ lines, orderDiscount }),
    lines,
    currency: "USD",
    amountTendered: 21,
    amountDue: 0,
    dueDate: "",
    today: "2026-09-09",
    canPickCustomer: true,
    ...over,
  };
};

describe("clientIssues — the cart", () => {
  it("passes a complete, fully-paid sale", () => {
    expect(clientIssues(clean())).toEqual({});
  });

  it("refuses an empty cart, which `items.min(1)` would refuse anyway", () => {
    const issues = clientIssues(clean({ lines: [] }));
    expect(issues.cart).toMatch(/ring something up/i);
  });

  it("names EVERY over-discounted line, where the server names only the first", () => {
    // `sale.service.ts:157` throws on the first line it meets, keyed
    // `errors.items`, so a two-line mistake would otherwise be two round trips.
    const lines = [
      { ...rice, discount: 999 },
      { ...oil, discount: 999 },
    ];
    const issues = clientIssues(clean({ lines }));

    expect(Object.keys(issues.lines ?? {})).toEqual([
      rice.productId,
      oil.productId,
    ]);
  });

  it("puts an over-large sale discount on the sale discount, not on a line", () => {
    const lines = [rice];
    const issues = clientIssues({
      ...clean({ lines }),
      cart: cartIssues({ lines, orderDiscount: 500 }),
    });

    expect(issues.orderDiscount).toBeDefined();
    expect(issues.lines).toBeUndefined();
  });
});

describe("clientIssues — the tender", () => {
  it("refuses a blank currency rather than guessing one", () => {
    // `payment.currency` has no default, and a hardcoded "USD" over a Kenyan
    // shop's takings is the failure the no-hardcoded-currency rule exists for.
    expect(clientIssues(clean({ currency: "" })).currency).toBeDefined();
  });

  it("refuses an empty amount, because an omitted one is not 'paid in full'", () => {
    // `docs/contracts/sales.md` trap 7: omitting `amountTendered` is a 422, it
    // does not default to the total.
    const issues = clientIssues(clean({ amountTendered: null, amountDue: 21 }));
    expect(issues.tendered).toMatch(/amount tendered/i);
  });

  it("does not also demand a customer while the amount box is still empty", () => {
    // Every untouched sale technically owes its whole total. Asking who owes a
    // bill nobody has paid yet answers a question that was not asked.
    const issues = clientIssues(clean({ amountTendered: null, amountDue: 21 }));
    expect(issues.customer).toBeUndefined();
    expect(issues.dueDate).toBeUndefined();
  });
});

describe("clientIssues — the credit block", () => {
  const owing = (over: Partial<ClientCheck> = {}) =>
    clientIssues(clean({ amountTendered: 5, amountDue: 16, ...over }));

  it("requires a customer once a tender leaves a balance", () => {
    // The server refuses with a 422 keyed `customerId` (`sale.service.ts:195`)
    // and re-checks it inside the transaction.
    expect(owing({ dueDate: "2026-12-31" }).customer).toMatch(/customer/i);
  });

  it("requires a due date once a tender leaves a balance", () => {
    expect(owing({ customerId: "cu1" }).dueDate).toMatch(/due/i);
  });

  it("refuses a due date before today IN THE BUSINESS'S timezone", () => {
    // `today` is the business's day, not the browser's — the server compares
    // against `startOfDayIn(organization.timezone, now)`.
    const issues = owing({ customerId: "cu1", dueDate: "2026-09-08" });
    expect(issues.dueDate).toMatch(/before today/i);
  });

  it("accepts today itself", () => {
    expect(
      owing({ customerId: "cu1", dueDate: "2026-09-09" }).dueDate,
    ).toBeUndefined();
  });

  it("explains the dead end for a role that cannot look customers up", () => {
    // `CustomerPicker` renders nothing at all without `customers:view`, so
    // without this the block would be an unfillable form with nothing in it.
    const issues = owing({ canPickCustomer: false, dueDate: "2026-12-31" });
    expect(issues.customer).toMatch(/can't look customers up/i);
  });

  it("asks for none of it once the sale is settled in full", () => {
    expect(clientIssues(clean({ amountTendered: 21, amountDue: 0 }))).toEqual(
      {},
    );
  });
});

describe("serverIssues — 409s", () => {
  it("puts INSUFFICIENT_STOCK on the line it names, with the line's own unit", () => {
    // The artboard puts this message on the cart row, not in a toast — the fix
    // is the stepper on that row. `details` is the only thing that says which.
    const error = new ApiError({
      message: "Insufficient stock",
      status: 409,
      code: API_ERROR_CODE.INSUFFICIENT_STOCK,
      details: { productId: rice.productId, requested: 2, available: 0.5 },
    });

    const issues = serverIssues(error, [rice, oil]);

    expect(issues.lines).toEqual({
      // "only 0.5 left" of what — kilos, cartons? — is the sentence that sends
      // somebody to count the wrong shelf.
      [rice.productId]: "Only 0.5 kg in stock, and this line asks for 2 kg.",
    });
    expect(issues.cart).toBeUndefined();
  });

  it("falls back to the API's sentence when the product is not in this cart", () => {
    const error = new ApiError({
      message: "Insufficient stock for Sugar",
      status: 409,
      code: API_ERROR_CODE.INSUFFICIENT_STOCK,
      details: { productId: "unknown", requested: 2, available: 0 },
    });

    expect(serverIssues(error, [rice])).toEqual({
      cart: "Insufficient stock for Sugar",
    });
  });

  it("shows PRODUCT_ARCHIVED over the cart, since it carries no id", () => {
    const error = new ApiError({
      message: "Cooking oil is archived",
      status: 409,
      code: API_ERROR_CODE.PRODUCT_ARCHIVED,
    });
    expect(serverIssues(error, [rice, oil]).cart).toBe(
      "Cooking oil is archived",
    );
  });

  it("shows CUSTOMER_ARCHIVED at the customer, since that is what to change", () => {
    const error = new ApiError({
      message: "Customer is archived",
      status: 409,
      code: API_ERROR_CODE.CUSTOMER_ARCHIVED,
    });
    expect(serverIssues(error, [rice]).customer).toBe("Customer is archived");
  });
});

describe("serverIssues — the 422 every credit-sale failure shares", () => {
  const validation = (fieldErrors: Record<string, string>) =>
    new ApiError({
      message: "Validation failed",
      status: 422,
      code: API_ERROR_CODE.VALIDATION_ERROR,
      fieldErrors,
    });

  it("routes each key to the control that can fix it", () => {
    // All five arrive as `VALIDATION_ERROR` — the service never passes a
    // distinct code — so the `errors` key is the ONLY way to tell them apart
    // (`docs/contracts/sales.md` §7, trap 3).
    expect(
      serverIssues(
        validation({
          customerId: "A customer is required",
          dueDate: "Due date cannot be in the past",
          "payment.currency": "Currency must be USD or KES",
          discount: "Discount exceeds the subtotal",
          items: "Discount on Basmati rice exceeds the line total",
        }),
        [rice, oil],
      ),
    ).toEqual({
      customer: "A customer is required",
      dueDate: "Due date cannot be in the past",
      currency: "Currency must be USD or KES",
      orderDiscount: "Discount exceeds the subtotal",
      // Names the product in its message but carries no index, so it cannot be
      // placed on a row.
      cart: "Discount on Basmati rice exceeds the line total",
    });
  });

  it("places an indexed zod line error on that line", () => {
    // `items.1.quantity` DOES carry an index, unlike the service's own `items`.
    expect(
      serverIssues(
        validation({ "items.1.quantity": "Enter a positive quantity" }),
        [rice, oil],
      ),
    ).toEqual({ lines: { [oil.productId]: "Enter a positive quantity" } });
  });

  it("keeps a key it does not recognise rather than dropping it", () => {
    const issues = serverIssues(validation({ somethingNew: "Nope" }), [rice]);
    expect(issues.cart).toBe("Nope");
  });

  it("says something for a 422 whose errors map is empty", () => {
    expect(serverIssues(validation({}), [rice]).cart).toBe("Validation failed");
  });
});

describe("serverIssues — what it deliberately does not handle", () => {
  it("is empty for a 500, so the caller shows a card with the request id", () => {
    const error = new ApiError({
      message: "Something went wrong",
      status: 500,
      code: API_ERROR_CODE.INTERNAL_SERVER_ERROR,
      requestId: "req_1",
    });
    expect(serverIssues(error, [rice])).toEqual({});
  });

  it("is empty for a dead network", () => {
    const error = new ApiError({
      message: "Network error",
      status: 0,
      code: API_ERROR_CODE.NETWORK_ERROR,
    });
    expect(serverIssues(error, [rice])).toEqual({});
  });

  it("is empty for anything that is not an ApiError at all", () => {
    expect(serverIssues(new Error("boom"), [rice])).toEqual({});
  });
});
