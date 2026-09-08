"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { productKeys } from "../keys";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "../schemas/product.schema";
import * as productService from "../services/product.service";
import type { Product } from "../types";

/**
 * The three product writes. Stock is not one of them — see
 * `use-stock-mutation.ts`; `PATCH /products/:id` cannot move a quantity.
 *
 * Nothing here shows an error. A failure belongs to the component that caused
 * it — `DUPLICATE_BARCODE` under the barcode field, `CATEGORY_NOT_FOUND` under
 * the category select (brief §8.4) — and a toast fired from `onError` here
 * would swallow it before the form ever heard about it.
 *
 * None of these is optimistic. All three change which page a row lands on and
 * what `meta.total` says, both of which only the server knows.
 */

export function useCreateProduct(): UseMutationResult<
  Product,
  ApiError,
  CreateProductInput
> {
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, CreateProductInput>({
    mutationFn: (input) => productService.create(input),
    onSuccess: (created) => {
      // Not optimism — the server has already answered. Seeding the detail
      // cache means "create, then open the new product" renders immediately
      // instead of showing a skeleton for data we are holding.
      queryClient.setQueryData(productKeys.detail(created.id), created);

      // `lists()`, not `all`: the detail entry above is correct, and
      // invalidating it would refetch what we just stored.
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      // A new barcode makes a previously-404ing scan resolve.
      void queryClient.invalidateQueries({ queryKey: productKeys.barcodes() });
    },
  });
}

/**
 * `PATCH /products/:id`. The id travels in the variables rather than as a hook
 * argument, so one instance serves a form, a row action and a bulk loop.
 *
 * **Send `unit` and `trackStock` on every call.** The API re-applies its own
 * defaults to whatever arrives, so a body that omits them resets the unit to
 * `"pcs"` and turns stock tracking on — including on the `{ status: "active" }`
 * un-archive. `docs/findings/s2-task-01.md` has the evidence.
 */
export interface UpdateProductVariables {
  id: ObjectId;
  input: UpdateProductInput;
}

export function useUpdateProduct(): UseMutationResult<
  Product,
  ApiError,
  UpdateProductVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, UpdateProductVariables>({
    mutationFn: ({ id, input }) => productService.update(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(productKeys.detail(updated.id), updated);
      // A PATCH can change the name, the category or the status, any of which
      // moves the row to a different page or out of the current filter. Only
      // the server knows where it belongs now.
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      // The barcode itself may have changed, so both the old code's entry and
      // the new one are suspect.
      void queryClient.invalidateQueries({ queryKey: productKeys.barcodes() });
    },
  });
}

/**
 * `DELETE /products/:id` — **archive**, and the UI must say "Archive" (brief §9).
 *
 * Not `removeQueries`, which is what a real delete would call: the product
 * still exists, `GET /products/:id` still returns it, and the detail page the
 * user is standing on should carry on rendering it with an "Archived" badge.
 * The response is the archived product, so the cache can simply be corrected.
 */
export function useArchiveProduct(): UseMutationResult<
  Product,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, ObjectId>({
    mutationFn: (id) => productService.archive(id),
    onSuccess: (archived) => {
      queryClient.setQueryData(productKeys.detail(archived.id), archived);
      // The default list is `status=active`, so the row leaves it entirely.
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      // Barcode lookup returns active products only: this product's code now
      // 404s, and a cached hit would let the counter sell an archived product.
      void queryClient.invalidateQueries({ queryKey: productKeys.barcodes() });
    },
  });
}
