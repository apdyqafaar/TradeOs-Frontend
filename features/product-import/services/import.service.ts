import { env } from "@/config/env";
import {
  apiDelete,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
} from "@/lib/api/client";
import { API_ERROR_CODE, ApiError } from "@/lib/api/errors";
import type { ApiEnvelope, ObjectId, Paginated } from "@/lib/api/types";
import type {
  ColumnMapPatchInput,
  ImportRowPatchInput,
  ResolveConflictInput,
} from "../schemas/import.schema";
import {
  type CommitImportResult,
  IMPORT_FILE_FIELD,
  IMPORT_TEMPLATE_FILENAME,
  type ImportJobDetail,
  type ImportJobListParams,
  type ImportJobSummary,
  type ImportRow,
  type ImportRowPageParams,
  type ImportTemplateFile,
  resolveImportRowParams,
} from "../types";

/**
 * The only file in this slice that knows a URL exists.
 *
 * No React, no hooks, no query client, no toasts. It does no envelope handling
 * either — the response interceptor in `lib/api/client` has already unwrapped
 * `{ success, message, data, meta }` and turned every failure into an
 * `ApiError` — with **one exception it cannot help with**, `downloadTemplate`,
 * which is documented where it sits.
 *
 * All ten `/products/import` rows in `docs/API-ROUTES.md` are wrapped here and
 * nothing else is. Every one of them gates on the single permission
 * **`products:create`** (`product-import.route.ts:52,68,77,86,95,104,113,122,
 * 131,140`) — there is no separate import permission, and the two extra
 * permissions the commit reads (`products:update`, `categories:create`) do not
 * gate the route, they change what the commit is allowed to do once inside it.
 *
 * **No organization id is sent**: `requireMember` resolves the tenant from the
 * caller's own session, and another business's job id is a **404**, not a 403,
 * so an id cannot be probed (`import-job.actions.ts:27`).
 *
 * ### Two structural facts that catch people
 *
 * **Three of these ten do not answer the shape the verb suggests.**
 * `DELETE /:id/rows/:index` returns **200 with the row** (now `skipped`), not
 * 204. `DELETE /:id` returns **204 with an empty body** and is a *soft cancel*
 * — the job survives as `status: "cancelled"` and keeps appearing in the list
 * until it expires; nothing in the backend ever deletes an import job.
 * `GET /template` returns raw `text/csv`.
 *
 * **Pagination metadata lives in two different places.** `GET /products/import`
 * puts it in the envelope's `meta`, which is what `apiGetList` reads. `POST /`
 * and `GET /:id` put it in **`data.rowsMeta`** and have no envelope `meta` at
 * all, so they go through `apiGet` and the caller reads `rowsMeta` off the
 * payload. The other five return neither.
 */

const BASE = "/products/import";

/* ------------------------------------------------------------------------ */
/* Reads                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * `GET /products/import` — the organization's jobs, newest first
 * (`{ createdAt: -1, _id: -1 }`), paginated.
 *
 * `{ params }`, not `params`: the second argument is an axios **config**, and
 * passing the filter object directly would hand axios a config full of keys it
 * does not recognise and send no query string at all — a list that silently
 * ignores the page number. (The scaffolder's `service.ts.template` writes
 * `apiGetList(BASE, params)`; it is wrong, and it has already been written
 * wrong in this repo once.)
 *
 * The query schema is `paginationQuerySchema.strict()`, so **`?status=` here is
 * a 422**, not an ignored key — the status filter belongs to `GET /:id` and
 * filters rows, not jobs.
 *
 * Rows are stripped at the database layer on this endpoint (`.select("-rows")`,
 * `import-job.actions.ts:31-39`), so `items[i].rows` is `undefined` and the
 * type is `ImportJobSummary` rather than `ImportJobDetail`.
 */
export const listJobs = (
  params: ImportJobListParams = {},
): Promise<Paginated<ImportJobSummary>> =>
  apiGetList<ImportJobSummary>(BASE, { params });

/**
 * `GET /products/import/:id` — one job plus one filtered page of its rows.
 *
 * Works on `committed` and `cancelled` jobs too; only the mutating endpoints
 * require `reviewing`.
 *
 * `params` is resolved through `resolveImportRowParams` so the request and the
 * query key that caches it are built from the same three concrete values —
 * see `keys.ts`. `limit` is capped at **200** here, not the usual 100.
 *
 * `rowsMeta.total` counts rows **after** the status filter, not `totalRows`.
 */
export const getJob = (
  id: ObjectId,
  params: ImportRowPageParams = {},
): Promise<ImportJobDetail> =>
  apiGet<ImportJobDetail>(`${BASE}/${id}`, {
    params: resolveImportRowParams(params),
  });

/**
 * `GET /products/import/template` — the starter CSV.
 *
 * **This one cannot go through the shared axios client, and that is not a
 * style choice.** The handler sets `Content-Type: text/csv` and sends a raw
 * string with no `{ success, message, data }` around it
 * (`product-import.controller.ts:213-218`). `lib/api/client`'s `unwrap`
 * interceptor runs on every response, sees a body that is not an envelope, and
 * throws `UNEXPECTED_RESPONSE` — and `responseType: "blob"` does not rescue it,
 * because a `Blob` is not an envelope either. Creating a second axios instance
 * is not an option (`lib/api/client.ts` is the only one), so this uses `fetch`.
 *
 * `credentials: "include"` is the whole auth story, exactly as
 * `withCredentials` is for the axios instance: the session is an httpOnly
 * cookie the browser attaches by itself, and the request is same-origin because
 * `next.config.ts` rewrites `/api/v1/*` to the Express server.
 *
 * Two consequences of bypassing the client, both deliberate:
 *
 *   1. **The central 401 redirect does not fire here.** A dead session on this
 *      one request surfaces as a thrown `ApiError` rather than a bounce to
 *      `/login`. That is acceptable because the page around it is already gated
 *      server-side by `app/(app)/layout.tsx`, and a download failing quietly
 *      into a redirect would be worse than an error the user can see.
 *   2. **Failures are normalised by hand** into the same `ApiError` every other
 *      function here throws, so a caller's `hasCode(...)` branch stays total.
 *
 * Note `validate({ query: noBodySchema, body: noBodySchema })` runs **first** on
 * this route and `noBodySchema` is `.strict()`, so **any query string at all is
 * a 422** — do not append a cache-buster.
 */
export const downloadTemplate = async (): Promise<ImportTemplateFile> => {
  const response = await fetch(`${env.apiBaseUrl}${BASE}/template`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/csv" },
  });

  if (!response.ok) throw await templateError(response);

  return { filename: IMPORT_TEMPLATE_FILENAME, csv: await response.text() };
};

/**
 * Turns a failed template response into the `ApiError` the rest of the app
 * throws. A failure here still carries the ordinary JSON envelope — only the
 * success path is `text/csv` — so the `code`, `message` and `requestId` a UI
 * needs are all available; the fallbacks exist for a body that never reached
 * the API at all (a proxy's HTML 502).
 */
const templateError = async (response: Response): Promise<ApiError> => {
  const envelope = await response
    .json()
    .then((body: unknown) => body as ApiEnvelope<unknown>)
    .catch(() => undefined);

  return new ApiError({
    message: envelope?.message || "Could not download the template.",
    status: response.status,
    code: envelope?.code ?? statusFallbackCode(response.status),
    fieldErrors: envelope?.errors,
    details: envelope?.details,
    requestId: response.headers.get("x-request-id") ?? undefined,
  });
};

/** Only the statuses this one endpoint can produce; anything else is a 5xx. */
const statusFallbackCode = (status: number): string => {
  switch (status) {
    case 401:
      return API_ERROR_CODE.UNAUTHORIZED;
    case 403:
      return API_ERROR_CODE.FORBIDDEN;
    case 422:
      return API_ERROR_CODE.VALIDATION_ERROR;
    case 429:
      return API_ERROR_CODE.TOO_MANY_REQUESTS;
    default:
      return API_ERROR_CODE.INTERNAL_SERVER_ERROR;
  }
};

/* ------------------------------------------------------------------------ */
/* Writes                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * `POST /products/import` — 201 with the job **and its first 20 rows**.
 *
 * ### The multipart body
 *
 * **Exactly one part, named exactly `file`.** `upload.single("file")` reads it
 * (`import-upload.middleware.ts:21`), `limits: { files: 1 }` refuses a second,
 * and — the part that is easy to get wrong — **no other field may ride along**:
 * `validate({ body: noBodySchema })` runs *after* multer and `noBodySchema` is
 * `z.object({}).strict().optional()`, so a smuggled text field is a 422
 * `VALIDATION_ERROR`. There is no `purpose` here, unlike `POST /uploads`.
 *
 * ### No `Content-Type` header, and none must be added
 *
 * `lib/api/client.ts` deliberately sets **no** instance-level `Content-Type`
 * precisely so this works: with a default in place, axios's `transformRequest`
 * sees a JSON content type, runs the `FormData` through `formDataToJSON` and
 * posts `{"file":{}}` — no error, no file, nothing in the types to suggest it.
 * With the default absent, the XHR adapter clears the content type for a
 * `FormData` body and the browser writes `multipart/form-data; boundary=…`
 * itself, which is the only way that boundary can be correct. Setting the
 * header to a literal string is the other half of the trap: a multipart body
 * without its `boundary=` parameter is unparseable.
 * (`features/uploads/services/upload.service.ts` still passes
 * `"Content-Type": null` — a harmless leftover from when the default existed.)
 *
 * ### The timeout
 *
 * Raised from the client's 30 s for the same reason `createUpload` raises it:
 * this is a request whose size the *user* chooses, and 5 MB over a phone
 * connection can take minutes. A timeout here throws away an upload that was
 * working, and — because of the rate limit below — the retry is not free.
 *
 * ### What it refuses
 *
 * | code | status | what happened |
 * |---|---|---|
 * | `IMPORT_FILE_TOO_LARGE` | **413** | over 5 MB, refused by multer mid-stream |
 * | `IMPORT_NO_ROWS` | 422 | no headers or no data rows — **also what a `.xls`, a `.pdf` or a `.txt` produces**, because CSV is the fall-through format |
 * | `IMPORT_TOO_MANY_ROWS` | 422 | over 2,000 data rows |
 * | `IMPORT_UNSUPPORTED_FORMAT` | 422 | zip-shaped but not a workbook — a `.docx` lands here |
 * | `VALIDATION_ERROR` | 422 | no `file` part, a second file, a wrong field name, or an extra text field |
 * | `TOO_MANY_REQUESTS` | 429 | the **21st** upload in 15 minutes **per organization**, not per member, with a `Retry-After` header |
 *
 * This is the one route in the ten where `validate` runs *last*, so an
 * anonymous caller gets a clean **401**. On the other nine `validate` runs
 * before `requireAuth`, and a malformed id or query returns **422 even with no
 * session** — never read a 422 as proof the session is alive.
 */
export const createJob = (file: File): Promise<ImportJobDetail> => {
  const form = new FormData();
  form.append(IMPORT_FILE_FIELD, file);

  return apiPost<ImportJobDetail>(BASE, form, { timeout: 120_000 });
};

/**
 * `PATCH /products/import/:id/columns` — 200 with the job summary, **no rows
 * and no `rowsMeta`** (`product-import.controller.ts:130`).
 *
 * The rows were all re-derived from `raw` and every manual edit on a
 * non-`skipped` row was destroyed, so the caller has to re-read `GET /:id` to
 * see what the file now looks like. See `columnMapPatchSchema` for the merge
 * semantics and the three shapes of its `errors` map.
 */
export const remapColumns = (
  id: ObjectId,
  input: ColumnMapPatchInput,
): Promise<ImportJobSummary> =>
  apiPatch<ImportJobSummary>(`${BASE}/${id}/columns`, input);

/**
 * `PATCH /products/import/:id/rows/:index` — 200 with **one row**, not the job.
 *
 * `index` is the row's own 0-based `index`, which is stable for the job's life;
 * it is not a position in the page the caller happens to be looking at.
 * An index that matches no row is **404 `IMPORT_ROW_NOT_FOUND`**.
 *
 * `counts` moved server-side and is not in this response, and the whole file
 * was re-reconciled — so rows the caller never touched may have changed status
 * too. The hook invalidates the job for exactly that reason.
 */
export const patchRow = (
  id: ObjectId,
  index: number,
  input: ImportRowPatchInput,
): Promise<ImportRow> =>
  apiPatch<ImportRow>(`${BASE}/${id}/rows/${index}`, input);

/**
 * `DELETE /products/import/:id/rows/:index` — **200 with the row**, now
 * `status: "skipped"` with its `errors` and `conflict` cleared. Not a 204, and
 * not a delete: the row stays in the file and is counted in `counts.skipped`.
 *
 * There is **no un-skip endpoint**. A `PATCH` revives the row — `editRow`
 * re-validates and reassigns `ready`/`needs_attention` unconditionally — so an
 * "undo" is a `patchRow` echoing one field from the row's own `parsed`.
 */
export const skipRow = (id: ObjectId, index: number): Promise<ImportRow> =>
  apiDelete<ImportRow>(`${BASE}/${id}/rows/${index}`);

/**
 * `POST /products/import/:id/rows/:index/resolve` — 200 with the row.
 *
 * **The row's `status` stays `"conflict"`.** Only `conflict.resolution`
 * changes, which is why `counts.conflict` never falls as the user works and why
 * `commitReadiness` needs the rows rather than the summary.
 *
 * 422 `IMPORT_ROW_NOT_CONFLICT` when the row is not currently in conflict.
 */
export const resolveConflict = (
  id: ObjectId,
  index: number,
  input: ResolveConflictInput,
): Promise<ImportRow> =>
  apiPost<ImportRow>(`${BASE}/${id}/rows/${index}/resolve`, input);

/**
 * `POST /products/import/:id/commit` — 200 with `{ result, productIds }`.
 *
 * **Not the job.** Re-read `GET /:id` for `status: "committed"` and the stored
 * `result`.
 *
 * No body: `validate({ params, body: noBodySchema })` accepts an absent body
 * and refuses any field in one.
 *
 * Everything happens in a single Mongo transaction — every `ready` row becomes
 * a product (writing an initial `adjustment` stock movement where
 * `quantity > 0`), every conflict row resolved `"update"` patches the existing
 * product with its **non-blank** fields only and writes one `restock` or
 * `adjustment` movement for a quantity difference, and missing categories are
 * created inside the same transaction. It is genuinely all-or-nothing.
 *
 * The four refusals, in the order the service checks them:
 *
 * | # | status / code | condition |
 * |---|---|---|
 * | 1 | 409 `IMPORT_NOT_REVIEWING` | already committed or cancelled |
 * | 2 | 422 `IMPORT_NOT_READY` | `needsAttention > 0` or an unresolved conflict; `details.counts` |
 * | 3 | 403 `FORBIDDEN` | a row resolved `"update"` and the caller lacks `products:update`; checked **before the transaction opens** |
 * | 4 | 422 `IMPORT_NOT_READY` | a committing row names a category that does not exist and the caller lacks `categories:create` |
 *
 * Refusals 2 and 4 share a code and only 4 **writes to the job before
 * throwing** — so always re-fetch after an `IMPORT_NOT_READY`. A duplicate
 * barcode created by someone else mid-transaction rolls everything back and
 * raises 409 `IMPORT_CONFLICT_CHANGED` with `details.rowIndex`. Anything else
 * propagates untranslated, including `STOCK_NOT_TRACKED` and
 * `CATEGORY_NOT_FOUND`, both of which the contract marks **unverified** through
 * this path — handle them generically.
 */
export const commitJob = (id: ObjectId): Promise<CommitImportResult> =>
  apiPost<CommitImportResult>(`${BASE}/${id}/commit`);

/**
 * `DELETE /products/import/:id` — **204 with an empty body**, and a soft cancel
 * rather than a delete.
 *
 * The document survives as `status: "cancelled"`, keeps its rows, keeps
 * appearing in `listJobs`, and disappears only when its TTL fires 7 days after
 * the *upload*. `noContentResponse` is `res.status(204).end()`, so there is no
 * envelope on this one — `unwrap` maps it to `undefined` and this resolves to
 * `void`.
 *
 * Cancelling anything that is not `reviewing` is 409 `IMPORT_NOT_REVIEWING`.
 */
export const cancelJob = (id: ObjectId): Promise<void> =>
  apiDelete<void>(`${BASE}/${id}`);
