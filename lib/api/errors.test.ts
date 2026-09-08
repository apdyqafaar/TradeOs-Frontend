import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODE,
  ApiError,
  fieldErrorsFor,
  hasCode,
  isApiError,
} from "@/lib/api/errors";

describe("ApiError", () => {
  it("carries the whole failure, not just a message", () => {
    const error = new ApiError({
      message: "Not enough stock",
      status: 409,
      code: API_ERROR_CODE.INSUFFICIENT_STOCK,
      details: { productId: "652f1c0a9b3e4d0012a4b7c1", available: 2 },
      requestId: "req_abc123",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Not enough stock");
    expect(error.status).toBe(409);
    expect(error.code).toBe("INSUFFICIENT_STOCK");
    expect(error.requestId).toBe("req_abc123");
    expect(error.details).toEqual({
      productId: "652f1c0a9b3e4d0012a4b7c1",
      available: 2,
    });
    expect(error.fieldErrors).toBeUndefined();
  });

  it("survives subclassing a built-in, so instanceof still works", () => {
    const error = new ApiError({
      message: "x",
      status: 500,
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(error instanceof ApiError).toBe(true);
  });

  it("freezes the code catalog", () => {
    expect(Object.isFrozen(API_ERROR_CODE)).toBe(true);
  });
});

describe("isApiError", () => {
  it("accepts an ApiError", () => {
    expect(
      isApiError(
        new ApiError({ message: "x", status: 404, code: "NOT_FOUND" }),
      ),
    ).toBe(true);
  });

  it("accepts a branded error minted by a second copy of this module", () => {
    // React Query stores errors in its own cache and Next can hand one across
    // a boundary where two copies of errors.ts exist; instanceof goes false.
    // `Symbol.for` is global, so the brand survives that.
    const fromAnotherCopy = Object.assign(new Error("Not found"), {
      status: 404,
      code: "NOT_FOUND",
      [Symbol.for("tradeos.api-error")]: true,
    });
    expect(isApiError(fromAnotherCopy)).toBe(true);
  });

  it("rejects an AxiosError, which also has a numeric status and a string code", () => {
    // This is the one that matters: waving it through would let a raw axios
    // error out of the client untouched, with `code: "ERR_BAD_REQUEST"`.
    const axiosLike = Object.assign(
      new Error("Request failed with status code 422"),
      {
        isAxiosError: true,
        status: 422,
        code: "ERR_BAD_REQUEST",
      },
    );
    expect(isApiError(axiosLike)).toBe(false);
  });

  it("rejects a plain Error, a plain object, null and a string", () => {
    expect(isApiError(new Error("boom"))).toBe(false);
    expect(isApiError({ status: 404, code: "NOT_FOUND" })).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("NOT_FOUND")).toBe(false);
  });
});

describe("hasCode", () => {
  const conflict = new ApiError({
    message: "That category is in use",
    status: 409,
    code: API_ERROR_CODE.CATEGORY_IN_USE,
  });

  it("is true only for the matching code", () => {
    expect(hasCode(conflict, API_ERROR_CODE.CATEGORY_IN_USE)).toBe(true);
    expect(hasCode(conflict, API_ERROR_CODE.CATEGORY_PROTECTED)).toBe(false);
  });

  it("is false for anything that is not an ApiError", () => {
    expect(
      hasCode(new Error("CATEGORY_IN_USE"), API_ERROR_CODE.CATEGORY_IN_USE),
    ).toBe(false);
    expect(hasCode(undefined, API_ERROR_CODE.CATEGORY_IN_USE)).toBe(false);
  });
});

describe("fieldErrorsFor", () => {
  const validation = new ApiError({
    message: "Validation failed",
    status: 422,
    code: API_ERROR_CODE.VALIDATION_ERROR,
    fieldErrors: {
      "items.0.quantity": "Quantity must be greater than 0",
      "items.1.productId": "Product not found",
      dueDate: "Due date cannot be in the past",
    },
  });

  it("returns the whole map when no prefix is given", () => {
    expect(fieldErrorsFor(validation)).toEqual({
      "items.0.quantity": "Quantity must be greater than 0",
      "items.1.productId": "Product not found",
      dueDate: "Due date cannot be in the past",
    });
  });

  it("returns a copy, so setError callers cannot mutate the error", () => {
    const map = fieldErrorsFor(validation);
    map.dueDate = "tampered";
    expect(validation.fieldErrors?.dueDate).toBe(
      "Due date cannot be in the past",
    );
  });

  it("strips a prefix and drops everything outside it", () => {
    expect(fieldErrorsFor(validation, "items")).toEqual({
      "0.quantity": "Quantity must be greater than 0",
      "1.productId": "Product not found",
    });
  });

  it("returns an empty map for a non-422 and for a non-ApiError", () => {
    const forbidden = new ApiError({
      message: "no",
      status: 403,
      code: "FORBIDDEN",
    });
    expect(fieldErrorsFor(forbidden)).toEqual({});
    expect(fieldErrorsFor(new Error("boom"))).toEqual({});
  });
});
