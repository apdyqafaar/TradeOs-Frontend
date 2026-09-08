import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { CustomerListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the list just keeps
 * showing the customer who was archived a minute ago. Naming each key once
 * removes that failure mode.
 *
 * The wrapper below is the only place in the slice that touches
 * `createQueryKeys`'s surface, so a change to that helper changes this file
 * and nothing else here.
 */
const keys = createQueryKeys("customers");

export const customerKeys = {
  /**
   * Everything this slice caches. Slice 3 will want this after a sale on
   * credit or a debt payment, both of which move a customer's `debtSummary`
   * without touching the customer row.
   */
  all: keys.all,

  /**
   * Every list, at any page, under any filter — what a create or an archive
   * invalidates. Both change which rows land on which page and both change
   * `meta.total`, so no single cached page can be patched to match.
   */
  lists: () => keys.lists,

  /** One list. `params` is hashed into the key, which is why it is flat and scalar-only. */
  list: (params: CustomerListParams) => keys.list({ ...params }),

  /** Every detail entry. */
  details: () => keys.details,

  /**
   * One customer **and their debt summary** — this key holds a
   * `CustomerDetail`, not a `Customer`, because that is what the endpoint
   * answers. A mutation that has only the customer half must merge into this
   * entry rather than overwrite it.
   */
  detail: (id: ObjectId) => keys.detail(id),
} as const;
