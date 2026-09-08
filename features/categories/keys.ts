import { createQueryKeys } from "@/lib/query/keys";

/**
 * `GET /categories` takes no parameters at all, so there is exactly one list
 * variant — `categoryKeys.list()` hashes to `["categories", "list", {}]`.
 * `createQueryKeys` is still used rather than a hand-written array so that
 * `invalidateQueries({ queryKey: categoryKeys.lists })` keeps working if a
 * later filter ever appears, and so this slice's keys read like every other
 * slice's.
 */
export const categoryKeys = createQueryKeys("categories");
