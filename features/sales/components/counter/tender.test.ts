import { describe, expect, it } from "vitest";
import {
  resolveRate,
  tenderOutcome,
} from "@/features/sales/components/counter/tender";

/**
 * The shop the backend's own fixtures use: books in USD, dollars and shillings
 * over the counter, `exchangeRate` 0.0077 — units of MAIN per one unit of
 * EXCHANGE (`credit.test.ts:33-41`).
 */
const USD_SHOP = {
  mainCurrency: "USD",
  exchangeCurrency: "KES",
  exchangeRate: 0.0077,
};

/** The same pair the other way up, which is the direction that reads wrong out
 *  loud: a Kenyan shop keeping books in KES and taking dollars at the till. */
const KES_SHOP = {
  mainCurrency: "KES",
  exchangeCurrency: "USD",
  exchangeRate: 130,
};

describe("resolveRate", () => {
  it("is 1 for the main currency and the config's rate for the exchange one", () => {
    expect(resolveRate("USD", USD_SHOP)).toBe(1);
    expect(resolveRate("KES", USD_SHOP)).toBe(0.0077);
  });

  it("does not care which of the two codes is the shop's own", () => {
    // The same pair the other way up. `exchangeRate` is units of MAIN per one
    // unit of EXCHANGE, so the number attaches to the *role* a code plays in
    // this business, never to the code itself.
    expect(resolveRate("KES", KES_SHOP)).toBe(1);
    expect(resolveRate("USD", KES_SHOP)).toBe(130);
  });

  it("refuses any other code rather than falling back to 1", () => {
    // `resolveRateFrom` (`sale.service.ts:52-61`) throws a 422 keyed
    // `payment.currency` for a third code. A silent fallback to 1 would price
    // a shilling tender as if it were dollars and only the receipt would say so.
    expect(resolveRate("EUR", USD_SHOP)).toBeNull();
  });

  it("refuses a blank code, which is what the config reads while loading", () => {
    expect(resolveRate("", { ...USD_SHOP, mainCurrency: "" })).toBeNull();
  });

  it("refuses a rate that could never price a bill", () => {
    // It is what divides in `change`; `Infinity` is not a state to be one bad
    // config away from.
    expect(resolveRate("KES", { ...USD_SHOP, exchangeRate: 0 })).toBeNull();
  });
});

describe("tenderOutcome — tendered in the main currency", () => {
  it("settles a bill paid exactly", () => {
    expect(
      tenderOutcome({ total: 267.75, amountTendered: 267.75, rate: 1 }),
    ).toEqual({
      amountPaidMain: 267.75,
      amountDue: 0,
      change: 0,
      paymentStatus: "paid",
    });
  });

  it("leaves the artboard's balance on a part payment", () => {
    // Artboard `2a`: USD 267.75 owed, USD 100.00 tendered, USD 167.75 due.
    expect(
      tenderOutcome({ total: 267.75, amountTendered: 100, rate: 1 }),
    ).toEqual({
      amountPaidMain: 100,
      amountDue: 167.75,
      change: 0,
      paymentStatus: "partial",
    });
  });

  it("is a credit sale when nothing is handed over", () => {
    // `amountDue === total` is the server's own definition of `credit`
    // (`sale.service.ts:208-209`), and it is what the cart shows before the
    // cashier has typed anything.
    expect(
      tenderOutcome({ total: 267.75, amountTendered: 0, rate: 1 }),
    ).toEqual({
      amountPaidMain: 0,
      amountDue: 267.75,
      change: 0,
      paymentStatus: "credit",
    });
  });

  it("gives change and never a negative balance on an overpayment", () => {
    expect(
      tenderOutcome({ total: 267.75, amountTendered: 300, rate: 1 }),
    ).toEqual({
      // `min(tenderedMain, total)` — the shop is never paid more than the bill.
      amountPaidMain: 267.75,
      amountDue: 0,
      change: 32.25,
      paymentStatus: "paid",
    });
  });

  it("calls a zero total paid, not credit", () => {
    // Both branches of the server's ternary are true here; its order decides,
    // and `paid` is first (`sale.service.ts:208`).
    expect(
      tenderOutcome({ total: 0, amountTendered: 0, rate: 1 }).paymentStatus,
    ).toBe("paid");
  });
});

describe("tenderOutcome — tendered in the exchange currency", () => {
  it("converts by MULTIPLYING, which is the direction that reads wrong", () => {
    // Main KES, exchange USD, rate 130: one dollar is worth 130 shillings, so
    // a USD 100 note settles a KES 13,000 bill exactly. Dividing here is how
    // this repo once printed KES 0.77 for a KES 13,000 tender.
    expect(
      tenderOutcome({ total: 13_000, amountTendered: 100, rate: 130 }),
    ).toEqual({
      amountPaidMain: 13_000,
      amountDue: 0,
      change: 0,
      paymentStatus: "paid",
    });
  });

  it("reports change in the TENDERED currency, not in main", () => {
    // KES 13,000 owed, USD 120 handed over. The customer gets USD 20 back —
    // not KES 2,600, which is the same money and the wrong note to hand over.
    const outcome = tenderOutcome({
      total: 13_000,
      amountTendered: 120,
      rate: 130,
    });
    expect(outcome.change).toBe(20);
    expect(outcome.change).not.toBe(2600);
    expect(outcome.amountDue).toBe(0);
  });

  it("reports the balance in MAIN currency on a part payment", () => {
    // USD 50 against a KES 13,000 bill: KES 6,500 paid, KES 6,500 still owed.
    // The balance is what a `Debt`'s principal becomes, and a debt is in the
    // books' currency.
    expect(
      tenderOutcome({ total: 13_000, amountTendered: 50, rate: 130 }),
    ).toEqual({
      amountPaidMain: 6_500,
      amountDue: 6_500,
      change: 0,
      paymentStatus: "partial",
    });
  });

  it("survives the fractional rate the backend's own fixtures use", () => {
    // 13000 * 0.0077 is 100.10000000000001 in binary floats, and 100.1 / 0.0077
    // is 13000.000000000002. Without the server's `round2` on both conversions
    // this is a bill that cannot be settled: a cent left owing and a fraction
    // of a shilling in change.
    expect(
      tenderOutcome({ total: 100.1, amountTendered: 13_000, rate: 0.0077 }),
    ).toEqual({
      amountPaidMain: 100.1,
      amountDue: 0,
      change: 0,
      paymentStatus: "paid",
    });
  });
});
