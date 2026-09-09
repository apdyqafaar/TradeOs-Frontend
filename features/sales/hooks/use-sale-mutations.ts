"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { customerKeys } from "@/features/customers/keys";
import { dashboardKeys } from "@/features/dashboard/keys";
import { debtKeys } from "@/features/debts/keys";
import { productKeys } from "@/features/products/keys";
import { saleKeys } from "@/features/sales/keys";
import type {
  CreateSaleInput,
  VoidSaleInput,
} from "@/features/sales/schemas/sale.schema";
import * as saleService from "@/features/sales/services/sale.service";
import type { Sale } from "@/features/sales/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * The two writes on `/sales`, and the cache work each one owes.
 *
 * **A sale is the widest-reaching write in this application**, and that is what
 * makes this file mostly invalidation. `docs/contracts/sales.md` §8 lists what a
 * single `POST /sales` moves, inside one transaction:
 *
 *   - the sales journal and its `meta.total`         -> `saleKeys`
 *   - `Product.quantity` on every **tracked** line,
 *     plus a `StockMovement` row per line            -> `productKeys`
 *   - a new `Debt` when `amountDue > 0`              -> `debtKeys`
 *   - that customer's `debtSummary`                  -> `customerKeys.detail`
 *   - today's takings on the Overview                -> `dashboardKeys`
 *
 * A void reverses the first four and changes the fifth. Anything left
 * un-invalidated here is a screen showing a figure that stopped being true the
 * moment the receipt printed — a stock count that says 12 when the shelf holds
 * 11, or a customer page that says nothing is outstanding while a debt exists.
 *
 * Neither mutation is optimistic, and that is a decision. A sale's totals,
 * receipt number, change and `amountDue` are all computed **server-side** from
 * a currency rate and product prices this browser does not own, and any of the
 * five failures below can refuse the whole thing. There is nothing honest to
 * paint before the answer arrives.
 *
 * Nothing here renders an error. `INSUFFICIENT_STOCK` belongs on the cart line
 * it names (its `details` carry `productId`, `requested`, `available`), a 422
 * belongs at the control its `errors` key identifies (`SALE_ERROR_FIELD`), and
 * a toast fired from `onError` would consume both first.
 */

/** The arguments a void needs. The hook takes none, so the id rides with the body. */
export interface VoidSaleVariables {
  id: ObjectId;
  input: VoidSaleInput;
}

/**
 * Which caches a completed or reversed sale invalidates, in one place.
 *
 * Shared by both mutations because a void undoes exactly what a create did: the
 * same stock moves back, the same debt changes state, the same customer's
 * balance shifts. Two copies of this list would drift, and the half that got
 * left behind would be the one nobody notices — a stale cache is silent.
 *
 * `productKeys.all` is the blunt instrument, deliberately. The response cannot
 * say which lines actually moved stock: `items[].trackStock` is stored
 * server-side and **is not on the wire** (`docs/contracts/sales.md` trap 10), so
 * the precise set of affected products is unknowable here. Guessing from
 * `items[].productId` would leave an untracked service's cache entry needlessly
 * refetched and a tracked one correct — the same work, with a wrong reason.
 */
const invalidateAfterSale = (
  queryClient: ReturnType<typeof useQueryClient>,
  sale: Sale,
): void => {
  // Ordering, `meta.total` and the void's strikethrough all change. No cached
  // page can be patched to match, so every list is asked again.
  void queryClient.invalidateQueries({ queryKey: saleKeys.lists() });

  // Quantities, stock movements and the barcode lookup the counter scans with —
  // `productKeys.all` covers lists, details, movements and barcodes at once.
  void queryClient.invalidateQueries({ queryKey: productKeys.all });

  // The Overview's takings. Its own keys file names this write: "invalidate
  // this after any write that moves a figure on the Overview".
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

  // A fully-paid sale opens no debt and cancels none, so it owes the debts and
  // customers caches nothing. `debtId` is present exactly when `amountDue > 0`
  // (`sale.controller.ts:37`), which is the only case that creates one — and a
  // void of such a sale cancels it, moving its `status` and `remaining`.
  if (!sale.debtId) return;

  void queryClient.invalidateQueries({ queryKey: debtKeys.all });

  // The customer's `debtSummary` lives on `GET /customers/:id`, not on the
  // customer list — the list endpoint returns no balance at all — so this is the
  // one key that moved, and `customerKeys.lists()` is correctly left alone.
  if (sale.customerId) {
    void queryClient.invalidateQueries({
      queryKey: customerKeys.detail(sale.customerId),
    });
  }
};

/**
 * `POST /sales` — the counter's commit. 201 with the recorded sale.
 *
 * The mutation's data is the whole `Sale`, so a caller that navigates to the
 * receipt from its own `onSuccess` lands on a page whose data is already in the
 * cache and never fetches it twice.
 *
 * The detail entry is **seeded rather than invalidated**: the 201 body is
 * `publicSale`, byte-identical to what `GET /sales/:id` would answer, and a
 * sale is immutable — nothing can have changed between the response and the
 * navigation. Seeding a shape the endpoint does not answer with is the mistake
 * to avoid, and here there is no such gap.
 *
 * Clearing the cart is the caller's job, not this hook's: the store is client
 * state owned by the counter screen, and a data hook that emptied it would make
 * a retry after a recoverable failure impossible.
 */
export function useCreateSale(): UseMutationResult<
  Sale,
  ApiError,
  CreateSaleInput
> {
  const queryClient = useQueryClient();

  return useMutation<Sale, ApiError, CreateSaleInput>({
    mutationFn: saleService.create,
    onSuccess: (sale) => {
      queryClient.setQueryData<Sale>(saleKeys.detail(sale.id), sale);
      invalidateAfterSale(queryClient, sale);
    },
  });
}

/**
 * `POST /sales/:id/void` — 200 with the voided sale.
 *
 * No id argument, so one instance serves a receipt screen opened for any sale.
 * Pass `{ id, input }`.
 *
 * `setQueryData`, not `removeQueries`: voiding does not destroy the receipt.
 * `GET /sales/:id` still answers 200 with `status: "voided"` and the void
 * metadata filled in, and the screen the user is standing on stays valid — the
 * banner is what changes. Removing the entry would blank the page and then
 * refetch the same sale back.
 *
 * Refused with 409 `DEBT_HAS_PAYMENTS` when a payment has already been taken
 * against this sale's debt, and 409 `SALE_ALREADY_VOIDED` on a second attempt.
 * Both are final — the caller shows them inline on the Void control, because
 * there is no field to fix and no amount of retrying will change the answer.
 */
export function useVoidSale(): UseMutationResult<
  Sale,
  ApiError,
  VoidSaleVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Sale, ApiError, VoidSaleVariables>({
    mutationFn: ({ id, input }) => saleService.voidSale(id, input),
    onSuccess: (sale) => {
      queryClient.setQueryData<Sale>(saleKeys.detail(sale.id), sale);
      invalidateAfterSale(queryClient, sale);
    },
  });
}
