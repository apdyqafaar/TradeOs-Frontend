"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { productKeys } from "../keys";
import type { StockMovementInput } from "../schemas/product.schema";
import * as productService from "../services/product.service";
import type { StockAdjustmentResult } from "../types";

/**
 * `POST /products/:id/stock` — a restock or a signed adjustment.
 *
 * **One write, three caches.** A stock movement is the one mutation in this
 * slice that changes more than the row it names, and getting the fan-out wrong
 * produces the most confusing bug in the feature: a restock that appears to do
 * nothing until the page is reloaded.
 *
 *   1. **The product itself** — its `quantity` changed, so the detail page's
 *      big number and its Low/Out badge are stale. The response carries the
 *      full updated product (the same `publicProduct` shape `GET /products/:id`
 *      returns), so the cache is *seeded* rather than invalidated: the number
 *      updates on the same frame, with no second request. Invalidating here
 *      instead would throw away the answer the server just gave us and refetch
 *      it.
 *   2. **Every list** — `quantity` is a column, and it is also a filter: a
 *      product can cross its low-stock threshold in either direction, so it may
 *      belong on or off the `lowStock=true` list now. Only the server knows.
 *   3. **This product's movements** — a row was appended, and it is the row the
 *      user just created. A movements table that does not refresh is an audit
 *      trail that looks like it lost the write.
 *
 * Plus the barcode lookups, because the counter's cached scan of this product
 * now holds the wrong quantity.
 *
 * Not optimistic, and it must not become so: the API can refuse with 409
 * `INSUFFICIENT_STOCK` (an adjustment below zero) or 409 `STOCK_NOT_TRACKED`
 * (an untracked or archived product), and rolling a stock figure back on
 * screen shows the user a number that was never true.
 */
export function useStockMutation(
  productId: ObjectId,
): UseMutationResult<StockAdjustmentResult, ApiError, StockMovementInput> {
  const queryClient = useQueryClient();

  return useMutation<StockAdjustmentResult, ApiError, StockMovementInput>({
    mutationFn: (input) => productService.adjustStock(productId, input),
    onSuccess: ({ product }) => {
      queryClient.setQueryData(productKeys.detail(productId), product);

      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      void queryClient.invalidateQueries({
        queryKey: productKeys.movements(productId),
      });
      void queryClient.invalidateQueries({ queryKey: productKeys.barcodes() });
    },
  });
}
