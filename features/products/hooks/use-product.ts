"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { productKeys } from "../keys";
import * as productService from "../services/product.service";
import type { Product } from "../types";

/**
 * One product by id.
 *
 * `id` is optional so the hook can be called before a route param has
 * resolved; `enabled` keeps it from firing with an empty id, which would cache
 * a 404 under a key nothing will ever invalidate.
 *
 * An archived product resolves normally here — `GET /products/:id` does not
 * filter by status — so a detail page reached from the archived list renders
 * the product with its badge rather than a not-found panel.
 */
export function useProduct(
  id: ObjectId | undefined,
): UseQueryResult<Product, ApiError> {
  return useQuery<Product, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under
    // the empty-string fallback.
    queryKey: productKeys.detail(id ?? ""),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // below, reaching this line means a wiring mistake worth seeing.
      if (!id) throw new Error("Product id is missing");
      return productService.getById(id);
    },
    enabled: Boolean(id),
  });
}

export interface UseProductByBarcodeOptions {
  /**
   * Defaults to "whenever `code` is not blank". Pass `false` while a scan is
   * still being typed: `GET /products/barcode/:code` validates the code as
   * 4–64 characters of `[A-Za-z0-9._-]`, so a half-entered value is a 422 and
   * a keystroke-driven input would fire one per character.
   */
  enabled?: boolean;
}

/**
 * `GET /products/barcode/:code` — the scan lookup.
 *
 * Slice 3's counter is the real caller: a barcode arrives from a scanner (or a
 * phone camera), this resolves it to a product, and the product goes in the
 * cart. Two properties of the endpoint matter to that caller and are easy to
 * be surprised by:
 *
 *   - **Active products only.** An archived product with a barcode is a 404
 *     here, which is the right answer — it must not be sellable — but it is a
 *     404 rather than an "archived" flag, so the counter shows "no product
 *     with that barcode" and cannot say more.
 *   - **A miss is a 404, not an empty result.** `error.status === 404` is the
 *     "unknown barcode" branch; there is no `data === null` case to check.
 *
 * The 404 is not retried (`lib/query/client.ts` treats every 4xx as final), so
 * the counter gets its answer on the first pass.
 */
export function useProductByBarcode(
  code: string,
  options: UseProductByBarcodeOptions = {},
): UseQueryResult<Product, ApiError> {
  const trimmed = code.trim();
  return useQuery<Product, ApiError>({
    queryKey: productKeys.byBarcode(trimmed),
    queryFn: () => productService.getByBarcode(trimmed),
    enabled: (options.enabled ?? true) && trimmed.length > 0,
  });
}
