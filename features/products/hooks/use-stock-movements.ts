"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId, Paginated } from "@/lib/api/types";
import { productKeys } from "../keys";
import * as productService from "../services/product.service";
import type { StockMovement, StockMovementListParams } from "../types";

/**
 * `GET /products/:id/stock-movements` — a product's audit trail, newest first.
 *
 * Pagination only; the endpoint offers no filter by type or date, so a "show
 * only adjustments" control would have to filter a page client-side and would
 * lie about the rest. Do not build one.
 *
 * `productId` is optional for the same reason `useProduct`'s is: the detail
 * page can render before its route param resolves. **An untracked product has
 * no movements to show** — the endpoint answers with an empty page rather than
 * an error, but the table should be absent for `trackStock: false` rather than
 * empty, per the plan's Global Constraints.
 */
export function useStockMovements(
  productId: ObjectId | undefined,
  params: StockMovementListParams = {},
): UseQueryResult<Paginated<StockMovement>, ApiError> {
  return useQuery<Paginated<StockMovement>, ApiError>({
    queryKey: productKeys.movementList(productId ?? "", params),
    queryFn: () => {
      if (!productId) throw new Error("Product id is missing");
      return productService.listStockMovements(productId, params);
    },
    enabled: Boolean(productId),
    // Paging the trail should not blank the table under the cursor.
    placeholderData: keepPreviousData,
  });
}
