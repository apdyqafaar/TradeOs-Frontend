/**
 * Registered in the global symbol registry, so a second copy of this module —
 * two bundles, a server/client boundary, a test that reset its module graph —
 * produces the same symbol and `isApiError` still recognises the error.
 */
const API_ERROR_BRAND: unique symbol = Symbol.for("tradeos.api-error");

/**
 * The one error type the data layer ever throws.
 *
 * The API answers every failure with the same envelope (`Backend/src/util/responses.ts`),
 * so a caller should never have to ask "is this an axios error, a network
 * blip, or a parsed body?". `lib/api/client.ts` converts all three into this
 * class before anything outside `lib/api/` sees them.
 */
export class ApiError extends Error {
  /**
   * The brand. `status: number` + `code: string` is not distinctive enough on
   * its own: an `AxiosError` has both (`code: "ERR_BAD_REQUEST"`), so a purely
   * structural check would wave raw axios errors through as normalised ones.
   */
  readonly [API_ERROR_BRAND] = true;
  /** HTTP status, or `0` when the request never reached the server. */
  readonly status: number;
  /** The envelope's machine-readable `code`. Branch on this, never on `message`. */
  readonly code: string;
  /** A 422's `errors` map: field path to message, ready for `setError`. */
  readonly fieldErrors?: Record<string, string>;
  /** The `X-Request-Id` header. Support asks for it, so surface it on error cards. */
  readonly requestId?: string;
  /** The envelope's `details`, e.g. `{ productId }` on an `INSUFFICIENT_STOCK`. */
  readonly details?: Record<string, unknown>;

  constructor(init: {
    message: string;
    status: number;
    code: string;
    fieldErrors?: Record<string, string>;
    requestId?: string;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.requestId = init.requestId;
    this.details = init.details;

    // Subclassing a built-in through a down-levelled target breaks the
    // prototype chain, so `instanceof ApiError` would be false without this.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Branded, not `instanceof`. React Query hands errors back through its own
 * cache and Next.js can carry one across a module boundary where two copies of
 * this file exist; either makes an `instanceof` check quietly false.
 */
export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError ||
  (typeof error === "object" && error !== null && API_ERROR_BRAND in error);

/** `hasCode(error, API_ERROR_CODE.INSUFFICIENT_STOCK)` — the branch the UI actually writes. */
export const hasCode = (error: unknown, code: string): boolean =>
  isApiError(error) && error.code === code;

/**
 * Every `code` the API emits, taken from `Backend/src/util/errors.ts` and the
 * services and middleware that raise them, plus the four this client
 * synthesises for failures that never produced an envelope.
 */
export const API_ERROR_CODE = Object.freeze({
  // Generic — the status/class table in Backend/README.md.
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  BAD_GATEWAY: "BAD_GATEWAY",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  // Auth. EMAIL_NOT_VERIFIED is a 403 the caller can clear themselves, so it
  // must never be rendered as "ask an owner for access".
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  CREDENTIALS_MISSING: "CREDENTIALS_MISSING",

  // Organizations.
  SEED_MISSING: "SEED_MISSING",

  // Periods — every `from`/`to` endpoint in the API, which is the twelve
  // reports plus the sales, debts and customers lists.
  //
  // These three are the odd ones out in this table: they are **400s raised
  // after validation passed**, not 422s. `validate` accepts `from`/`to` as
  // soon as they match `/^\d{4}-\d{2}-\d{2}$/`, and it is `resolvePeriod` —
  // running inside the service — that then rejects the pair
  // (`Backend/src/lib/period.ts:79,84,86-88`, transcribed in
  // `docs/contracts/reports.md` §1.4). So a caller who branches only on
  // `status === 422` and `fieldErrors` never sees them, which is exactly how
  // they went unmapped until the reports slice.
  /** `from` after `to`, or one of the pair missing. `period.ts:79,84`. */
  INVALID_PERIOD: "INVALID_PERIOD",
  /** More than `MAX_PERIOD_DAYS` (366) inclusive days apart. `period.ts:86-88`. */
  PERIOD_TOO_LONG: "PERIOD_TOO_LONG",
  /** Date-shaped but not a date on the calendar — `2026-02-31`. `period.ts:51,58`. */
  INVALID_DATE: "INVALID_DATE",

  // Products and stock.
  DUPLICATE_BARCODE: "DUPLICATE_BARCODE",
  PRODUCT_ARCHIVED: "PRODUCT_ARCHIVED",
  STOCK_NOT_TRACKED: "STOCK_NOT_TRACKED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  /**
   * A permanent delete refused because the product has been sold.
   * `details.saleCount` carries how many times, which is the number the
   * decision is actually made on. 409 from `DELETE /products/:id/permanent`.
   */
  PRODUCT_HAS_SALES: "PRODUCT_HAS_SALES",

  // Categories.
  CATEGORY_EXISTS: "CATEGORY_EXISTS",
  CATEGORY_IN_USE: "CATEGORY_IN_USE",
  CATEGORY_PROTECTED: "CATEGORY_PROTECTED",
  CATEGORY_NOT_FOUND: "CATEGORY_NOT_FOUND",

  // Customers.
  DUPLICATE_PHONE: "DUPLICATE_PHONE",
  CUSTOMER_ARCHIVED: "CUSTOMER_ARCHIVED",
  CUSTOMER_HAS_OPEN_DEBT: "CUSTOMER_HAS_OPEN_DEBT",

  // Sales.
  SALE_ALREADY_VOIDED: "SALE_ALREADY_VOIDED",

  // Debts and payments.
  DEBT_HAS_PAYMENTS: "DEBT_HAS_PAYMENTS",
  DEBT_NOT_OPEN: "DEBT_NOT_OPEN",
  DEBT_WRITTEN_OFF: "DEBT_WRITTEN_OFF",
  PAYMENT_EXCEEDS_BALANCE: "PAYMENT_EXCEEDS_BALANCE",
  PAYMENT_ALREADY_VOIDED: "PAYMENT_ALREADY_VOIDED",

  // Projects.
  ALREADY_PUBLISHED: "ALREADY_PUBLISHED",

  // Uploads.
  STORAGE_NOT_CONFIGURED: "STORAGE_NOT_CONFIGURED",
  STORAGE_ERROR: "STORAGE_ERROR",
  UNSUPPORTED_IMAGE: "UNSUPPORTED_IMAGE",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UPLOAD_PENDING_LIMIT: "UPLOAD_PENDING_LIMIT",
  UPLOAD_ATTACHED: "UPLOAD_ATTACHED",
  UPLOAD_PURPOSE_MISMATCH: "UPLOAD_PURPOSE_MISMATCH",

  // Product import.
  IMPORT_UNSUPPORTED_FORMAT: "IMPORT_UNSUPPORTED_FORMAT",
  IMPORT_FILE_TOO_LARGE: "IMPORT_FILE_TOO_LARGE",
  IMPORT_TOO_MANY_ROWS: "IMPORT_TOO_MANY_ROWS",
  IMPORT_NO_ROWS: "IMPORT_NO_ROWS",
  IMPORT_UNKNOWN_HEADER: "IMPORT_UNKNOWN_HEADER",
  IMPORT_NOT_REVIEWING: "IMPORT_NOT_REVIEWING",
  IMPORT_ROW_NOT_FOUND: "IMPORT_ROW_NOT_FOUND",
  IMPORT_ROW_NOT_CONFLICT: "IMPORT_ROW_NOT_CONFLICT",
  IMPORT_CONFLICT_CHANGED: "IMPORT_CONFLICT_CHANGED",
  IMPORT_NOT_READY: "IMPORT_NOT_READY",

  // Client-side only. The API never sends these; `lib/api/client.ts` mints
  // them so a caller's `error.code` branch is total.
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  UNEXPECTED_RESPONSE: "UNEXPECTED_RESPONSE",
} as const);

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

/**
 * The 422 field map, safe to hand straight to react-hook-form.
 *
 * `prefix` strips a leading path segment the API adds but the form does not
 * have: sale line errors arrive as `items.0.quantity` while a nested form
 * registered under `items` names them `0.quantity`. Non-matching keys are
 * dropped when a prefix is given, so a banner can still be shown for them by
 * comparing sizes.
 */
export const fieldErrorsFor = (
  error: unknown,
  prefix?: string,
): Record<string, string> => {
  if (!isApiError(error) || !error.fieldErrors) return {};
  if (!prefix) return { ...error.fieldErrors };

  const head = `${prefix}.`;
  const scoped: Record<string, string> = {};
  for (const [field, message] of Object.entries(error.fieldErrors)) {
    if (field.startsWith(head)) scoped[field.slice(head.length)] = message;
  }
  return scoped;
};
