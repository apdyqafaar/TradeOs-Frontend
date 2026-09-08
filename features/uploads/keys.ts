import type { ListUploadsParams } from "@/features/uploads/types";
import { createQueryKeys } from "@/lib/query/keys";

const keys = createQueryKeys("uploads");

/**
 * The query keys for the gallery.
 *
 * Two things about `createQueryKeys` that are easy to get wrong (both cost a
 * failing typecheck in this slice's neighbours — `docs/findings/s2-task-04.md`):
 *
 * 1. `all`, `lists` and `details` are readonly **arrays**, not functions. This
 *    wrapper exposes `lists()` as a function so every call site reads the same
 *    way whether it takes arguments or not; `uploadKeys.lists` alone would be
 *    the array and `uploadKeys.lists()` would be a type error on the raw
 *    helper.
 * 2. `list()` takes `QueryKeyParams`, which is `Record<string, unknown>`. An
 *    **interface** is not assignable to that — TypeScript gives implicit index
 *    signatures to anonymous object types and type aliases but never to
 *    interfaces — so `keys.list(params)` does not compile and
 *    `keys.list({ ...params })` does. The spread is load-bearing, not styling.
 *
 * There is no `detail` here on purpose: the API has no `GET /uploads/:id`
 * (`docs/API-ROUTES.md` lists exactly three upload rows), so a key for a
 * single upload would describe a request nothing can make.
 */
export const uploadKeys = {
  /** Everything this slice caches. */
  all: keys.all,
  /** Every gallery variant, whatever its filters — the invalidation target. */
  lists: () => keys.lists,
  /** One filtered gallery page. */
  list: (params: ListUploadsParams = {}) => keys.list({ ...params }),
} as const;
