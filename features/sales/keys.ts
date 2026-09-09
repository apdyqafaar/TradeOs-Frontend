import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import type { SaleListParams } from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the sales list simply goes
 * on showing a sale that was voided a minute ago.
 *
 * `lists` and `details` on `createQueryKeys` are readonly **tuples, not
 * functions**; they are wrapped as functions here only so every member of this
 * object is called the same way at the use site. (The scaffolder's
 * `keys.ts.template` writes `keys.lists()` against the raw helper and does not
 * compile — see `docs/findings/s2-task-01.md`.)
 */
const keys = createQueryKeys("sales");

export const saleKeys = {
  /**
   * Everything this slice caches. The blunt instrument — a void has a detail
   * entry it can patch precisely, so reach for a narrower key first.
   */
  all: keys.all,

  /**
   * Every list, at any page, under any filter. What a create or a void
   * invalidates: both change which rows land on which page (`createdAt: -1`,
   * newest first) and a create changes `meta.total`, so no cached page can be
   * patched to match.
   */
  lists: () => keys.lists,

  /** One list. `params` is hashed into the key, which is why `SaleListParams` is flat. */
  list: (params: SaleListParams) => keys.list(params),

  /** Every detail entry. */
  details: () => keys.details,

  /**
   * One sale. Holds a whole `Sale` — the same shape a create and a void answer
   * with, so both mutations seed this key directly instead of refetching a
   * receipt the server just handed them.
   */
  detail: (id: ObjectId) => keys.detail(id),
} as const;
