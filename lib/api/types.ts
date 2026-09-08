/**
 * The wire format. Every TradeOs API response — success or failure — has this
 * shape, produced by the backend's `src/util/responses.ts`. Nothing outside
 * `lib/api/` should ever see it: the axios response interceptor unwraps
 * `data` and turns a failure into an `ApiError`, so services and hooks work
 * with domain types only.
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  /** Human-readable. Safe to show; never branch on it. */
  message: string;
  data?: T;
  /** Present on a 422: a map of field path to message. */
  errors?: Record<string, string>;
  /** Machine-readable failure kind. This is what code branches on. */
  code?: string;
  /** Extra machine-readable context, when the raising error supplied it. */
  details?: Record<string, unknown>;
  meta?: PageMeta;
}

/** Pagination envelope on list endpoints. */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** What `apiGetList` returns: the rows plus their pagination meta. */
export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/** Query parameters every paginated list endpoint accepts. */
export interface PaginationParams {
  page?: number;
  /** The API caps this at 100. */
  limit?: number;
}

/**
 * The period selector shared by every report endpoint: either `period`, or
 * `from` and `to` together — never both, and never one of the pair alone.
 * Dates are calendar dates (`YYYY-MM-DD`) resolved in the business timezone.
 */
export type PeriodParams =
  | { period?: "today" | "week" | "month" | "year"; from?: never; to?: never }
  | { period?: never; from: string; to: string };

/** An id path parameter. Every id in this API is a MongoDB ObjectId string. */
export type ObjectId = string;
