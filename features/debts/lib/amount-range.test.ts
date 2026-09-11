import { describe, expect, it } from "vitest";
import { amountRangeIssue, parseAmount } from "./amount-range";

describe("parseAmount", () => {
  it("reads a plain number", () => {
    expect(parseAmount("1250.50")).toBe(1250.5);
  });

  it("treats an empty box as no filter, not as zero", () => {
    // The difference matters: "no filter" and "exactly 0" are different
    // questions, and `Number("")` is 0, which would answer the second when
    // the first was asked.
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("0")).toBe(0);
  });

  it("refuses a number with junk after it", () => {
    // `parseFloat("12abc")` is 12 and would silently filter on a number the
    // person did not type. This is the reason `Number` is used instead.
    expect(parseAmount("12abc")).toBeNull();
  });
});

describe("amountRangeIssue", () => {
  it("passes an empty pair — no filter is not an error", () => {
    expect(amountRangeIssue("", "")).toBeNull();
  });

  it("passes a half-open range in either direction", () => {
    // The server takes either key on its own, so "over 500" and "under 500"
    // are both real questions a shopkeeper asks.
    expect(amountRangeIssue("500", "")).toBeNull();
    expect(amountRangeIssue("", "500")).toBeNull();
  });

  it("passes a normal range, including equal ends", () => {
    expect(amountRangeIssue("500", "2000")).toBeNull();
    expect(amountRangeIssue("500", "500")).toBeNull();
  });

  it("catches a reversed range rather than sending it", () => {
    // The server answers 422 for this rather than an empty list, deliberately
    // — an impossible range is a typo. Catching it here means the person sees
    // why while they are still looking at the boxes.
    expect(amountRangeIssue("2000", "500")).toBe("reversed");
  });

  it("does not call a half-open range reversed", () => {
    // Nothing to compare against. The obvious wrong implementation treats a
    // missing max as 0 and calls every "over N" reversed.
    expect(amountRangeIssue("2000", "")).toBeNull();
  });

  it("catches a negative amount", () => {
    expect(amountRangeIssue("-5", "")).toBe("negative");
    expect(amountRangeIssue("", "-5")).toBe("negative");
  });

  it("catches more than two decimal places", () => {
    // `moneySchema` is 2dp on the server; three would be a 422 after a round
    // trip. 0.1 + 0.2 style drift must NOT trip it, which is why the check is
    // an epsilon rather than a string length.
    expect(amountRangeIssue("10.555", "")).toBe("too-precise");
    expect(amountRangeIssue("10.55", "")).toBeNull();
    expect(amountRangeIssue("0.30", "")).toBeNull();
    expect(amountRangeIssue("1e-7", "")).toBe("too-precise");
  });

  it("catches text", () => {
    expect(amountRangeIssue("abc", "")).toBe("invalid");
    expect(amountRangeIssue("500", "lots")).toBe("invalid");
  });

  it("reports the worse problem first when a pair has two", () => {
    // A negative AND reversed pair should say negative: fixing the sign is
    // the first thing to do, and "smallest below largest" is confusing advice
    // when one of them is -5.
    expect(amountRangeIssue("-5", "-10")).toBe("negative");
  });
});
