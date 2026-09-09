import { describe, expect, it } from "vitest";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import {
  createDebtSchema,
  dueDateFromCalendarDate,
  recordPaymentSchema,
  remainingFromPaymentError,
  voidPaymentSchema,
  writeOffDebtSchema,
} from "./debt.schema";

const CUSTOMER_ID = "652f1a2b3c4d5e6f70819234";

const validDebt = {
  customerId: CUSTOMER_ID,
  amount: 1250.5,
  dueDate: "2026-09-30T12:00:00.000Z",
  description: "Two bags of cement",
};

describe("createDebtSchema", () => {
  it("accepts the body POST /debts actually takes", () => {
    expect(createDebtSchema.safeParse(validDebt).success).toBe(true);
  });

  it("requires a description — the manual-create validator has no default", () => {
    const { description: _dropped, ...withoutDescription } = validDebt;
    expect(createDebtSchema.safeParse(withoutDescription).success).toBe(false);
    expect(
      createDebtSchema.safeParse({ ...validDebt, description: "   " }).success,
    ).toBe(false);
    expect(
      createDebtSchema.safeParse({ ...validDebt, description: "d".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("refuses a customerId that is not 24 hex characters", () => {
    for (const customerId of [
      "",
      "abc",
      `${CUSTOMER_ID}0`,
      "zzzzzzzzzzzzzzzzzzzzzzzz",
    ]) {
      expect(
        createDebtSchema.safeParse({ ...validDebt, customerId }).success,
        customerId,
      ).toBe(false);
    }
  });

  // The whole reason `dueDateFromCalendarDate` exists. `z.string().datetime()`
  // on the backend accepts neither of the two things a date input and a TZDate
  // hand you: a bare calendar date, or an ISO string carrying an offset.
  it("refuses a bare YYYY-MM-DD due date", () => {
    expect(
      createDebtSchema.safeParse({ ...validDebt, dueDate: "2026-09-30" })
        .success,
    ).toBe(false);
  });

  it("refuses an offset-form due date, which is what TZDate.toISOString() emits", () => {
    expect(
      createDebtSchema.safeParse({
        ...validDebt,
        dueDate: "2026-09-30T12:00:00.000+03:00",
      }).success,
    ).toBe(false);
  });

  it("accepts a Z-form instant, with or without milliseconds", () => {
    for (const dueDate of [
      "2026-09-30T12:00:00Z",
      "2026-09-30T12:00:00.000Z",
    ]) {
      expect(
        createDebtSchema.safeParse({ ...validDebt, dueDate }).success,
        dueDate,
      ).toBe(true);
    }
  });

  it("holds the money bounds: > 0, at most 2 decimals, finite", () => {
    for (const amount of [
      0,
      -1,
      1250.505,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e12 + 1,
    ]) {
      expect(
        createDebtSchema.safeParse({ ...validDebt, amount }).success,
        String(amount),
      ).toBe(false);
    }
    for (const amount of [0.01, 8.29, 1250.5, 1e12]) {
      expect(
        createDebtSchema.safeParse({ ...validDebt, amount }).success,
        String(amount),
      ).toBe(true);
    }
  });

  it("is strict — a server-set field in the body is a 422, so it is a parse failure here", () => {
    for (const extra of [
      { status: "open" },
      { principal: 10 },
      { remaining: 10 },
    ]) {
      expect(
        createDebtSchema.safeParse({ ...validDebt, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe("recordPaymentSchema", () => {
  it("uppercases and trims the currency, because the API does before it checks the length", () => {
    const parsed = recordPaymentSchema.safeParse({
      amount: 6410,
      currency: " kes ",
    });
    expect(parsed.success && parsed.data.currency).toBe("KES");
  });

  it("takes a 3-letter code and nothing else", () => {
    for (const currency of ["", "KE", "KESH", "Kenyan Shilling"]) {
      expect(
        recordPaymentSchema.safeParse({ amount: 10, currency }).success,
        currency,
      ).toBe(false);
    }
  });

  it("holds the money bounds: > 0, at most 2 decimals", () => {
    for (const amount of [0, -50, 10.001]) {
      expect(
        recordPaymentSchema.safeParse({ amount, currency: "USD" }).success,
        String(amount),
      ).toBe(false);
    }
    for (const amount of [0.01, 50, 6410, 8.29]) {
      expect(
        recordPaymentSchema.safeParse({ amount, currency: "USD" }).success,
        String(amount),
      ).toBe(true);
    }
  });

  it("drops a blank note instead of storing an empty string on the record", () => {
    for (const note of ["", "   "]) {
      const parsed = recordPaymentSchema.safeParse({
        amount: 50,
        currency: "USD",
        note,
      });
      expect(parsed.success, JSON.stringify(note)).toBe(true);
      expect(parsed.success && parsed.data.note).toBeUndefined();
      // `JSON.stringify` drops an undefined value, so the request body omits
      // the key entirely rather than sending `note: null`.
      expect(parsed.success && JSON.stringify(parsed.data)).not.toContain(
        "note",
      );
    }
  });

  it("keeps a real note, trimmed, and bounds it at 500", () => {
    const parsed = recordPaymentSchema.safeParse({
      amount: 50,
      currency: "USD",
      note: "  paid at the counter  ",
    });
    expect(parsed.success && parsed.data.note).toBe("paid at the counter");
    expect(
      recordPaymentSchema.safeParse({
        amount: 50,
        currency: "USD",
        note: "n".repeat(501),
      }).success,
    ).toBe(false);
  });

  // No `exchangeRate` field exists on this request: the server resolves and
  // freezes the rate itself, and the body is strict.
  it("refuses an exchangeRate the caller tried to set", () => {
    expect(
      recordPaymentSchema.safeParse({
        amount: 50,
        currency: "USD",
        exchangeRate: 130,
      }).success,
    ).toBe(false);
  });
});

describe("writeOffDebtSchema / voidPaymentSchema", () => {
  it("both require a non-empty reason", () => {
    for (const schema of [writeOffDebtSchema, voidPaymentSchema]) {
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ reason: "" }).success).toBe(false);
      expect(schema.safeParse({ reason: "   " }).success).toBe(false);
      expect(schema.safeParse({ reason: "r".repeat(501) }).success).toBe(false);
      expect(schema.safeParse({ reason: "Customer left town" }).success).toBe(
        true,
      );
    }
  });

  // The write-off body carries no amount: the server writes off whatever
  // `remaining` holds at that instant, read from the document itself.
  it("refuses an amount on a write-off", () => {
    expect(
      writeOffDebtSchema.safeParse({ reason: "Bad debt", amount: 100 }).success,
    ).toBe(false);
  });

  it("gives each action its own wording, since the API's is generic", () => {
    const writeOff = writeOffDebtSchema.safeParse({ reason: "" });
    const voided = voidPaymentSchema.safeParse({ reason: "" });
    const messageOf = (result: typeof writeOff) =>
      result.success ? "" : result.error.issues[0]?.message;
    expect(messageOf(writeOff)).not.toBe(messageOf(voided));
  });
});

describe("dueDateFromCalendarDate", () => {
  it("produces an instant createDebtSchema accepts", () => {
    const dueDate = dueDateFromCalendarDate("2026-09-30", "Africa/Nairobi");
    expect(dueDate.endsWith("Z")).toBe(true);
    expect(createDebtSchema.safeParse({ ...validDebt, dueDate }).success).toBe(
      true,
    );
  });

  it("is noon in the business timezone, not midnight UTC", () => {
    // Nairobi is UTC+3 year-round: noon local is 09:00Z the same day.
    expect(dueDateFromCalendarDate("2026-09-30", "Africa/Nairobi")).toBe(
      "2026-09-30T09:00:00.000Z",
    );
    // New York is UTC-4 in September: noon local is 16:00Z. Midnight UTC would
    // have been 20:00 on the 29th locally — before the start of the picked day,
    // which is what the server refuses.
    expect(dueDateFromCalendarDate("2026-09-30", "America/New_York")).toBe(
      "2026-09-30T16:00:00.000Z",
    );
  });

  it("refuses anything that is not a calendar date rather than shifting it silently", () => {
    for (const value of [
      "",
      "30/09/2026",
      "2026-9-30",
      "2026-09-30T00:00:00Z",
    ]) {
      expect(
        () => dueDateFromCalendarDate(value, "Africa/Nairobi"),
        value,
      ).toThrow(RangeError);
    }
  });
});

describe("remainingFromPaymentError", () => {
  // The 422 path: the pre-transaction check knows the balance and sends it.
  it("reads the balance off the 422", () => {
    const error = new ApiError({
      message: "Payment exceeds the remaining balance",
      status: 422,
      code: API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
      fieldErrors: { amount: "Payment exceeds the remaining balance" },
      details: { remaining: 76.5 },
    });
    expect(remainingFromPaymentError(error)).toBe(76.5);
  });

  // The 409 path: a concurrent payment won the guarded update, so the server
  // does not claim to know the balance and sends no details at all.
  it("returns undefined for the 409 race, rather than inventing a balance", () => {
    const error = new ApiError({
      message: "Payment no longer fits the balance",
      status: 409,
      code: API_ERROR_CODE.PAYMENT_EXCEEDS_BALANCE,
    });
    expect(remainingFromPaymentError(error)).toBeUndefined();
  });

  it("ignores every other failure", () => {
    const notOpen = new ApiError({
      message: "Debt is not open",
      status: 409,
      code: API_ERROR_CODE.DEBT_NOT_OPEN,
    });
    expect(remainingFromPaymentError(notOpen)).toBeUndefined();
    expect(remainingFromPaymentError(new Error("offline"))).toBeUndefined();
    expect(remainingFromPaymentError(undefined)).toBeUndefined();
  });
});
