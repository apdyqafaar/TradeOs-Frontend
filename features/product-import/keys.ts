import type { ObjectId } from "@/lib/api/types";
import { createQueryKeys } from "@/lib/query/keys";
import {
  type ImportJobListParams,
  type ImportRowPageParams,
  resolveImportRowParams,
} from "./types";

/**
 * Every React Query key this slice uses, in one file.
 *
 * A key spelled inline at the `useQuery` site and again at the
 * `invalidateQueries` site is two arrays that have to stay equal forever, and
 * when they stop being equal nothing breaks loudly — the reviewer just goes on
 * showing "3 need attention" over rows that were fixed a minute ago. On a
 * screen whose whole job is telling someone which rows are still wrong, that is
 * the failure that wastes their afternoon.
 *
 * `lists` and `details` on `createQueryKeys` are readonly **tuples, not
 * functions** (`lib/query/keys.ts:19-23`); they are wrapped as functions here
 * only so every member of this object is called the same way at the use site.
 * The scaffolder's `keys.ts.template` writes `keys.lists()` against the raw
 * helper and does not compile — see `docs/findings/s2-task-01.md`.
 *
 * ### Why one job's rows live *under* its detail key
 *
 * There is no rows endpoint: `GET /products/import/:id` answers the job **and**
 * one filtered page of its rows in a single response, so a page of rows is not
 * a separate resource that could be invalidated separately. It is also not safe
 * to treat it as one — the server re-runs a **file-wide** reconciliation on
 * every row mutation (`product-import.service.ts:189-192`), so fixing one half
 * of a duplicate-barcode pair flips the other half to `ready` without anyone
 * touching it (`import.test.ts:281-291`). A row edit can therefore change rows
 * on pages the caller never looked at, and `counts` along with them.
 *
 * So `jobPage(id, …)` nests beneath `detail(id)`: one
 * `invalidateQueries({ queryKey: importKeys.detail(id) })` reaches **every**
 * page and every status filter of that job at once, which is the only
 * invalidation that is actually correct after a write.
 */
const keys = createQueryKeys("product-import");

export const importKeys = {
  /**
   * Everything this slice caches. The blunt instrument — `detail(id)` is
   * already whole-job, so reach for that first.
   */
  all: keys.all,

  /**
   * Every job list, at any page. What an upload, a remap, a row write, a commit
   * and a cancel all invalidate: `publicJobSummary` carries `counts` and
   * `status`, so a list row goes stale on every one of them, and an upload
   * moves `meta.total` besides.
   */
  lists: () => keys.lists,

  /** One page of the job list. `params` is hashed into the key. */
  list: (params: ImportJobListParams = {}) => keys.list({ ...params }),

  /** Every job's detail, whatever the id. */
  details: () => keys.details,

  /**
   * One job, **every page and every status filter of it**. This is the
   * invalidation target after any mutation, for the file-wide-reconciliation
   * reason above. Nothing queries this key directly.
   */
  detail: (id: ObjectId) => keys.detail(id),

  /**
   * One job at one row page under one status filter — what `useImportJob`
   * actually queries.
   *
   * `params` is resolved through `resolveImportRowParams` here rather than at
   * the call site so that `{}`, `{ page: 1 }` and the fully-spelled
   * `{ status: "all", page: 1, limit: 20 }` cannot hash to three different keys
   * for one request. That matters most where it is easiest to get wrong: the
   * upload mutation seeds this key from the `POST` response, which is page 1 of
   * 20 rows at `status: "all"`, and a seed under a key nothing reads is a
   * wasted round trip nobody notices.
   */
  jobPage: (id: ObjectId, params: ImportRowPageParams = {}) =>
    [...keys.detail(id), resolveImportRowParams(params)] as const,
} as const;
