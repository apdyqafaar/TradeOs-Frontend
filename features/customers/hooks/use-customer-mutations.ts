"use client";

import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { customerKeys } from "@/features/customers/keys";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "@/features/customers/schemas/customer.schema";
import * as customerService from "@/features/customers/services/customer.service";
import type { Customer, CustomerDetail } from "@/features/customers/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * The three writes on `/customers`, and the cache work each one owes.
 *
 * None of them is optimistic, and that is a decision. A create and an archive
 * both change which rows land on which page and both change `meta.total` —
 * server facts — so an optimistic insert or removal would make the pagination
 * footer lie until the refetch corrects it. And every one of these can be
 * refused: `DUPLICATE_PHONE` on the first two, `CUSTOMER_HAS_OPEN_DEBT` on the
 * third. A rollback the user watched happen is worse than a spinner.
 *
 * Nothing here renders an error. A 409 belongs at the control the user has to
 * change (`CUSTOMER_CONFLICT_FIELDS` maps the one that has a field), and a
 * toast fired from `onError` here would consume it first.
 */

/** The arguments a patch needs. The hook takes none, so the id rides with the body. */
export interface UpdateCustomerVariables {
  id: ObjectId;
  input: UpdateCustomerInput;
}

/**
 * `POST /customers`.
 *
 * The mutation's data is the created `Customer`, so a caller's
 * `mutate(input, { onSuccess: (customer) => … })` receives the row itself.
 * **Slice 3's counter depends on exactly that**: its quick-create selects the
 * new customer the moment the server confirms them, and anything else here —
 * a void, a wrapper object — would leave it re-fetching a customer it was just
 * handed.
 *
 * The detail cache is deliberately *not* seeded from this response.
 * `customerKeys.detail(id)` holds a `CustomerDetail`, and a create answers
 * only the customer half; writing a `debtSummary` we were never given would
 * put an invented figure in the cache, which is the one thing this feature
 * must never do. The first visit to the new customer's page costs one request
 * instead.
 */
export function useCreateCustomer(): UseMutationResult<
  Customer,
  ApiError,
  CreateCustomerInput
> {
  const queryClient = useQueryClient();

  return useMutation<Customer, ApiError, CreateCustomerInput>({
    mutationFn: customerService.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

/**
 * `PATCH /customers/:id`.
 *
 * No id argument, so one instance serves an edit sheet that may be opened for
 * any row — and so the counter can reuse it. Pass `{ id, input }`.
 *
 * A PATCH cannot move a debt, so the cached `debtSummary` is still correct: the
 * updater merges the new customer into the existing entry instead of replacing
 * it. Returning `undefined` when there is no entry leaves the cache untouched
 * rather than parking a half-built `CustomerDetail` in it.
 */
export function useUpdateCustomer(): UseMutationResult<
  Customer,
  ApiError,
  UpdateCustomerVariables
> {
  const queryClient = useQueryClient();

  return useMutation<Customer, ApiError, UpdateCustomerVariables>({
    mutationFn: ({ id, input }) => customerService.update(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<CustomerDetail>(
        customerKeys.detail(updated.id),
        (previous) =>
          previous ? { ...previous, customer: updated } : undefined,
      );
      // A patch can change the name or the phone, both of which the list
      // sorts and searches on, so the row may belong on a different page now.
      // Only the server knows; invalidate and ask.
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

/**
 * `DELETE /customers/:id` — which archives.
 *
 * `setQueryData`, not `removeQueries`: archiving does not destroy the row.
 * `GET /customers/:id` still answers 200 with `status: "archived"`, the detail
 * page stays on screen, and the archived banner is what changes. Removing the
 * entry would blank the page the user is standing on and then refetch the same
 * customer back.
 *
 * The lists still need invalidating, because the default filter is
 * `status=active` and the customer has just left it.
 *
 * Refused with 409 `CUSTOMER_HAS_OPEN_DEBT` when the customer has any open
 * debt. The caller shows that inline on the Archive button — there is no field
 * to fix, and no amount of retrying will change the answer.
 */
export function useArchiveCustomer(): UseMutationResult<
  Customer,
  ApiError,
  ObjectId
> {
  const queryClient = useQueryClient();

  return useMutation<Customer, ApiError, ObjectId>({
    mutationFn: customerService.archive,
    onSuccess: (archived) => {
      queryClient.setQueryData<CustomerDetail>(
        customerKeys.detail(archived.id),
        (previous) =>
          previous ? { ...previous, customer: archived } : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}
