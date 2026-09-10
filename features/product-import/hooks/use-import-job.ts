"use client";

import {
  keepPreviousData,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { importKeys } from "../keys";
import * as importService from "../services/import.service";
import {
  type ImportJobDetail,
  type ImportRowPageParams,
  MAX_IMPORT_ROW_LIMIT,
  resolveImportRowParams,
} from "../types";

/**
 * One import job and one filtered page of its rows — the reviewer's whole data
 * source.
 *
 * There is no separate rows endpoint: `GET /products/import/:id` answers the
 * summary and the page together, so this single query owns both `counts` in the
 * header and the rows in the table. Filtering and paging are done in memory
 * server-side over the whole loaded document, so `limit` bounds what crosses
 * the wire, not what the server reads.
 *
 * `id` is optional so the hook can be called before a route param has resolved.
 * `enabled` keeps it from firing with an empty id, which would cache a 404
 * under a key nothing will ever invalidate.
 *
 * ### The row limit here is 200, not 100
 *
 * Every other list endpoint in this API caps `limit` at 100; this one caps at
 * 200 (`product-import.validation.ts:15`), and `?limit=201` is a 422. A
 * 2,000-row review is ten calls at the cap and twenty at the shared constant,
 * which is why `MAX_IMPORT_ROW_LIMIT` is its own value and why passing a
 * repo-wide page-size constant here would under-fetch by half.
 *
 * ### Why the params are resolved rather than passed through
 *
 * `{}`, `{ page: 1 }` and `{ status: "all", page: 1, limit: 20 }` all describe
 * the same request but hash to three different query keys. Resolving the
 * server's own defaults on this side collapses them to one, which is what lets
 * the upload mutation seed this cache from its `POST` response and actually be
 * read. `resolveImportRowParams` is idempotent, so the key and the request are
 * built from the same call and cannot disagree.
 *
 * ### What a caller must not do with the result
 *
 * **Do not patch this cache after a row write.** The server re-runs a file-wide
 * reconciliation on every mutation, so fixing one duplicate barcode flips its
 * partner to `ready` on a page nobody was looking at, and `counts` moves with
 * it. `use-import-mutations.ts` invalidates the whole job for that reason;
 * merging one returned row into a cached page would leave the other rows and
 * the header counts quietly wrong.
 *
 * This works on `committed` and `cancelled` jobs too — only the mutating
 * endpoints require `reviewing` — so a receipt screen reads it the same way.
 * A 404 covers both "no such job" and "belongs to another business", and an
 * expired job 404s as well: the TTL is absolute at 7 days from **upload**, and
 * committing does not exempt it.
 */
export function useImportJob(
  id: ObjectId | undefined,
  params: ImportRowPageParams = {},
): UseQueryResult<ImportJobDetail, ApiError> {
  const resolved = resolveImportRowParams(params);

  return useQuery<ImportJobDetail, ApiError>({
    // Only reached when `enabled` is true, so nothing is ever fetched under the
    // empty-string fallback.
    queryKey: importKeys.jobPage(id ?? "", resolved),
    queryFn: () => {
      // Narrowed, not cast. `id as ObjectId` compiles and lies; with `enabled`
      // below, reaching this line means a wiring mistake, which is a bug rather
      // than something to paper over.
      if (!id) throw new Error("Import job id is missing");
      return importService.getJob(id, resolved);
    },
    enabled: Boolean(id),
    // Status filter and page are both in the key, so switching the "needs
    // attention" tab is a new query. Holding the previous rows keeps the table
    // from collapsing to a skeleton on every tab press.
    placeholderData: keepPreviousData,
  });
}

/**
 * Every conflicted row of a job in one query — what `commitReadiness` needs and
 * what a job summary can never provide.
 *
 * A resolved conflict keeps `status: "conflict"`, so `counts.conflict` is also
 * the count of rows this must hold before it can answer "yes, this can be
 * committed". One page at the 200 cap covers any job with 200 or fewer
 * conflicts, which is the overwhelming majority; beyond that, `rowsMeta`
 * reports `totalPages > 1` and the caller has to page — `commitReadiness` will
 * keep saying `conflicts_not_loaded` until it has them all, which is the
 * correct answer rather than a Commit button that 422s.
 *
 * It shares `useImportJob`'s cache entry for `{ status: "conflict", page,
 * limit: 200 }`, so the reviewer's own conflict tab and this pre-flight check
 * are one request, not two.
 */
export function useImportJobConflicts(
  id: ObjectId | undefined,
  page = 1,
): UseQueryResult<ImportJobDetail, ApiError> {
  return useImportJob(id, {
    status: "conflict",
    page,
    limit: MAX_IMPORT_ROW_LIMIT,
  });
}
