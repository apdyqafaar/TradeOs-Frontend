import { apiGet, apiGetList, apiPost } from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type { CreateSaleInput, VoidSaleInput } from "../schemas/sale.schema";
import type { Sale, SaleListParams } from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * Four functions for the four `features/sales` rows in `docs/API-ROUTES.md`,
 * and nothing else. **There is no update and no delete** — a sale is immutable
 * and its only transition is `completed -> voided`. If you find yourself
 * reaching for `PATCH /sales/:id`, it does not exist.
 */

/**
 * The tenant is not in this path and never will be. `requireMember` resolves
 * the caller's organization from their own session on every request.
 */
const BASE = "/sales";

/**
 * What actually goes on the wire, which is not quite what the caller holds.
 *
 * `listSalesQuerySchema` is `.strict()` **and** carries two refinements, so
 * this translation is not cosmetic — each mismatch below is a 422 rather than
 * an ignored filter:
 *
 *   - `period` and `from`/`to` are mutually exclusive
 *     (`common.validation.ts:82-84`). A URL that still holds a stale `from`
 *     when the user picks "This month" would send both.
 *   - `from` and `to` must be present together (`common.validation.ts:85-87`),
 *     and a date-range picker exists in the half-filled state — one date
 *     chosen, the other not — for as long as it takes to click twice.
 *
 * Both are dropped here rather than guarded in every caller, because the answer
 * to an incomplete range is "no date filter", not an error card. `undefined`
 * values are omitted from the query string by axios, so an absent key is what
 * the server sees.
 */
interface SaleListQuery {
  page?: number;
  limit?: number;
  status?: SaleListParams["status"];
  paymentStatus?: SaleListParams["paymentStatus"];
  customerId?: ObjectId;
  soldBy?: ObjectId;
  period?: SaleListParams["period"];
  from?: string;
  to?: string;
}

const toListQuery = (params: SaleListParams): SaleListQuery => {
  // A complete range beats a preset only when there is no preset — sending
  // both is a 422, and silently preferring one is better than showing the user
  // an error about a combination the UI let them build.
  const hasRange = !params.period && Boolean(params.from) && Boolean(params.to);

  return {
    page: params.page,
    limit: params.limit,
    status: params.status,
    paymentStatus: params.paymentStatus,
    customerId: params.customerId,
    soldBy: params.soldBy,
    period: params.period,
    from: hasRange ? params.from : undefined,
    to: hasRange ? params.to : undefined,
  };
};

/**
 * `GET /sales` — `sales:view`. Paginated, so `apiGetList`.
 *
 * The query goes in `{ params }`, an axios request **config**. Passing the
 * filter object as the second argument directly type-checks (every field of an
 * `AxiosRequestConfig` is optional) and sends no query string at all — a list
 * that quietly ignores every filter and stays on page 1. That mistake has
 * already been made in this repo.
 *
 * Note what omitting `status` means here, and how it differs from the other
 * lists: the backend defaults it to `"all"`, so voided sales are **included**
 * unless the caller narrows it. Products and customers default to `active`.
 *
 * With neither `period` nor `from`/`to`, no date filter is applied at all —
 * every sale ever recorded is in scope (`list.test.ts:161-171`). A counter
 * screen wanting "today" must ask for it.
 */
export const list = (params: SaleListParams = {}): Promise<Paginated<Sale>> =>
  apiGetList<Sale>(BASE, { params: toListQuery(params) });

/**
 * `GET /sales/:id` — `sales:view`.
 *
 * A 404 means the sale does not exist **or** belongs to another business; the
 * API answers 404 rather than 403 for a cross-tenant id so an id cannot be
 * probed (`list.test.ts:217-226`). Treat both as "not found".
 *
 * **A malformed id is a 422, not a 404** — `idParamSchema` runs in the
 * middleware chain before the handler, so `/sales/abc` fails the 24-hex regex
 * and never reaches the lookup. A not-found screen keyed only on 404 shows a
 * red error card to someone who mistyped a URL.
 *
 * A voided sale is returned here normally, with `status: "voided"` and the void
 * metadata filled in — voiding never hides a receipt (`void.test.ts:189-203`).
 */
export const getById = (id: ObjectId): Promise<Sale> =>
  apiGet<Sale>(`${BASE}/${id}`);

/**
 * `POST /sales` — `sales:create`. **201** with the recorded sale.
 *
 * Build the body with `buildSalePayload` from `../store/cart`; it is the piece
 * that knows which fields to omit. The failures worth naming, because each
 * belongs at a different control:
 *
 *   - 409 `INSUFFICIENT_STOCK`, `details: { productId, requested, available }`
 *     — inline on that cart line, with the available quantity.
 *   - 409 `PRODUCT_ARCHIVED` / `CUSTOMER_ARCHIVED` — on the line, on the picker.
 *   - 404 `NOT_FOUND` — a product or customer id that is gone or belongs to
 *     another business. Indistinguishable from each other by `code`.
 *   - 422 `VALIDATION_ERROR` for everything else, told apart only by the
 *     `errors` keys in `SALE_ERROR_FIELD`.
 *
 * A refused request consumes no receipt number: the sequence is drawn inside
 * the transaction, after stock is reserved (`docs/contracts/sales.md` §8).
 */
export const create = (input: CreateSaleInput): Promise<Sale> =>
  apiPost<Sale>(BASE, input);

/**
 * `POST /sales/:id/void` — `sales:void`, and **200**, not 201.
 *
 * Not a delete: the sale stays readable with `status: "voided"`, so this is
 * typed `Promise<Sale>` and the receipt on screen goes on rendering. Stock is
 * restored only for lines whose `trackStock` was true **at sale time**, a flag
 * that is not on the wire at all — the frontend cannot predict which lines move.
 *
 * `Seller` does not hold `sales:void` (`Backend/src/lib/permissions.ts:119-136`),
 * so gate the control on `useCan("sales:void")`.
 *
 * Two 409s, both final: `SALE_ALREADY_VOIDED` when it has been voided already
 * (it can happen at most once, races included), and `DEBT_HAS_PAYMENTS` when a
 * payment has been taken against the debt this sale opened. The second is
 * checked **before** stock is touched, so a refusal leaves everything as it was.
 */
export const voidSale = (id: ObjectId, input: VoidSaleInput): Promise<Sale> =>
  apiPost<Sale>(`${BASE}/${id}/void`, input);
