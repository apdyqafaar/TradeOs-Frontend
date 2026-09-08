import {
  apiDelete,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
} from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";
import type {
  CreateProductInput,
  StockMovementInput,
  UpdateProductInput,
} from "../schemas/product.schema";
import type {
  Product,
  ProductListParams,
  StockAdjustmentResult,
  StockMovement,
  StockMovementListParams,
} from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It also does no envelope
 * handling: the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError`, so what these functions return is the domain object.
 *
 * Eight functions for the eight `features/products` rows in
 * `docs/API-ROUTES.md`, and nothing else. The import endpoints in that file are
 * a separate slice.
 */

/**
 * The tenant is not in this path and never will be. `requireMember` resolves
 * the caller's organization from their own session on every request.
 */
const BASE = "/products";

/**
 * What actually goes on the wire, which is not what the caller holds.
 *
 * `listProductsQuerySchema` is `.strict()`, so this translation is not
 * cosmetic — every mismatch below is a 422 rather than an ignored filter:
 *
 *   - `lowStock` is `z.enum(["true"])`, so the wire value is the **string**
 *     `"true"` or the key is absent. A boolean `false` serialises as `"false"`
 *     and fails the enum.
 *   - `search` is `min(1)` after trimming, so an empty box — which is what
 *     `nuqs` hands back when the user clears it — must drop the key entirely.
 */
interface ProductListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProductListParams["status"];
  categoryId?: ObjectId;
  lowStock?: "true";
}

const toListQuery = (params: ProductListParams): ProductListQuery => {
  const search = params.search?.trim();
  return {
    page: params.page,
    limit: params.limit,
    // `|| undefined` rather than `?? undefined`: "" is the value to drop.
    search: search || undefined,
    status: params.status,
    categoryId: params.categoryId,
    lowStock: params.lowStock ? "true" : undefined,
  };
};

/**
 * `GET /products` — paginated, so `apiGetList`.
 *
 * The query goes in `{ params }`, an axios request config. Passing the filter
 * object as the second argument directly type-checks (every field of an
 * `AxiosRequestConfig` is optional) and sends **no query string at all**, which
 * looks like a broken filter rather than a bug.
 */
export const list = (
  params: ProductListParams = {},
): Promise<Paginated<Product>> =>
  apiGetList<Product>(BASE, { params: toListQuery(params) });

/**
 * `GET /products/:id`
 *
 * A 404 means the product does not exist **or** it belongs to another
 * business; the API answers 404 rather than 403 for a cross-tenant id so an id
 * cannot be probed for existence. Treat both as "not found". Archived products
 * are returned normally here — only the barcode lookup filters them out.
 */
export const getById = (id: ObjectId): Promise<Product> =>
  apiGet<Product>(`${BASE}/${id}`);

/**
 * `GET /products/barcode/:code` — the counter's scan lookup.
 *
 * **Active products only** (`findActiveProductByBarcode`), so an archived
 * product with a barcode is a 404 here while still being fetchable by id. The
 * code is encoded even though a valid barcode contains nothing that needs it:
 * this receives raw input from a scanner or a keyboard, not a validated value.
 */
export const getByBarcode = (code: string): Promise<Product> =>
  apiGet<Product>(`${BASE}/barcode/${encodeURIComponent(code)}`);

/** `POST /products` — 201 with the created product. */
export const create = (input: CreateProductInput): Promise<Product> =>
  apiPost<Product>(BASE, input);

/**
 * `PATCH /products/:id` — 200 with the full updated product.
 *
 * Two things this endpoint does not do. It does **not** move stock: a
 * `quantity` in the body is honoured only when `trackStock` flips false → true
 * and is discarded otherwise. And it cannot archive: `status` accepts only
 * `"active"`, for un-archiving.
 *
 * It also re-applies its own defaults to whatever arrives, so a body that
 * omits `unit` or `trackStock` resets them to `"pcs"` and `true`. Always send
 * both, carrying the product's current values — see
 * `docs/findings/s2-task-01.md`.
 */
export const update = (
  id: ObjectId,
  input: UpdateProductInput,
): Promise<Product> => apiPatch<Product>(`${BASE}/${id}`, input);

/**
 * `DELETE /products/:id` — **archive**, not delete (brief §9).
 *
 * Returns the archived product rather than a 204, so the caller can put it
 * straight back in the cache and the detail page can go on rendering it with
 * an "Archived" badge instead of a not-found panel. Its images are detached
 * and released, so `images` comes back empty.
 */
export const archive = (id: ObjectId): Promise<Product> =>
  apiDelete<Product>(`${BASE}/${id}`);

/**
 * `POST /products/:id/stock` — the only way a person can move stock.
 *
 * Answers with both halves of the write: the product at its new quantity and
 * the movement row that was appended. Refused with 409 `STOCK_NOT_TRACKED` for
 * an untracked or archived product, and 409 `INSUFFICIENT_STOCK` when an
 * adjustment would drive the quantity below zero.
 */
export const adjustStock = (
  id: ObjectId,
  input: StockMovementInput,
): Promise<StockAdjustmentResult> =>
  apiPost<StockAdjustmentResult>(`${BASE}/${id}/stock`, input);

/**
 * `GET /products/:id/stock-movements` — newest first, paginated.
 *
 * The query schema is `paginationQuerySchema.strict()`: `page` and `limit` and
 * nothing else. There is no filter by type or by date here.
 */
export const listStockMovements = (
  id: ObjectId,
  params: StockMovementListParams = {},
): Promise<Paginated<StockMovement>> =>
  apiGetList<StockMovement>(`${BASE}/${id}/stock-movements`, {
    params: { page: params.page, limit: params.limit },
  });
