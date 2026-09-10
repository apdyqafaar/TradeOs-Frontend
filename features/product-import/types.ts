import type { ObjectId, PageMeta, PaginationParams } from "@/lib/api/types";

/**
 * The wire shapes of the **ten** `/products/import` rows in
 * `docs/API-ROUTES.md`.
 *
 * Transcribed from the two shapers every JSON-speaking one of them maps
 * through — `publicJobSummary`
 * (`../Backend/src/controller/product-import.controller.ts:52-67`) and
 * `publicRow` (`product-import.controller.ts:36-50`) — and cross-checked
 * against the verified contract in `docs/contracts/product-import.md`, which
 * wins over the design and over REST intuition.
 *
 * Five rules run through the whole file:
 *
 *   1. **Ids are `id`, never `_id`**, and every nested reference is a
 *      `.toString()`'d string: `conflict.existingProductId` and
 *      `parsed.categoryId` are plain 24-hex strings, not objects, and neither
 *      carries a name (contract Trap 15).
 *   2. **Optional keys are ABSENT, not `null`.** `res.json` drops an
 *      `undefined`, so `conflict`, `committedAt`, `committedProductIds` and
 *      `result` simply are not there until they apply. Never write
 *      `row.conflict === null` (Trap 16). The one deliberate exception is
 *      `columnMap`, whose values really are `null`.
 *   3. **Dates are ISO 8601 strings**, not `Date`s. Feed them to
 *      `formatDate(iso, timezone)` with the business timezone.
 *   4. **`counts.needsAttention` is camelCase; the row status is
 *      `needs_attention` snake_case.** They are not interchangeable, and
 *      `counts[row.status]` is `undefined` (Trap 14).
 *   5. **No currency anywhere.** `costPrice` and `sellingPrice` are bare
 *      numbers in the organization's main currency — the import job carries no
 *      currency field, so the code comes from `useOrganization().currency` and
 *      goes through `formatMoney`. Never hardcode one.
 */

/**
 * The whole job status enum (`../Backend/src/db/models/import-job.model.ts:11`).
 *
 * There is deliberately no `parsing`/`processing`/`failed`: the file is parsed
 * **synchronously inside the upload request**, so either the `POST` returns a
 * `reviewing` job or the `POST` itself failed. Do not build a polling loop.
 */
export type ImportJobStatus = "reviewing" | "committed" | "cancelled";

/**
 * The whole row status enum (`import-job.model.ts:10`). Exactly four — there is
 * no `pending`, `error`, `imported` or `created`, and a row's status does not
 * change after a commit: a committed job's rows still read `ready`.
 *
 * **`conflict` is not cleared by resolving it.** `resolveConflict` writes only
 * `conflict.resolution` and leaves `status: "conflict"`
 * (`product-import.service.ts:434`), which is why `counts.conflict === 0` is
 * the wrong "ready to commit" test — see `commitReadiness` in
 * `schemas/import.schema.ts`.
 */
export type ImportRowStatus =
  | "ready"
  | "needs_attention"
  | "conflict"
  | "skipped";

/**
 * What `?status=` on `GET /products/import/:id` accepts: the four row statuses
 * plus `"all"`, which is also the server's default
 * (`../Backend/src/validators/product-import.validation.ts:13`).
 *
 * The query schema is `.strict()`, so anything outside this list is a 422
 * rather than a filter the server quietly ignores. Ordered as a filter control
 * should offer them — the default first, then the two states that need work.
 */
export const IMPORT_ROW_STATUS_FILTERS = [
  "all",
  "needs_attention",
  "conflict",
  "ready",
  "skipped",
] as const;

/** `?status=` on `GET /products/import/:id`. Derived, so it cannot drift. */
export type ImportRowStatusFilter = (typeof IMPORT_ROW_STATUS_FILTERS)[number];

/**
 * The ten product fields a file column can feed, in the order the backend
 * declares them (`../Backend/src/services/import/columns.ts:8-19`).
 *
 * This is the complete key set of `columnMap` — all ten are **always present**
 * on the wire, seeded to `null` (`columns.ts:88-91`) — and the exact set
 * `remapColumns` will accept as patch keys; anything else is a 422
 * `VALIDATION_ERROR` (not `IMPORT_UNKNOWN_HEADER`) raised at the service layer
 * (`product-import.service.ts:298-302`, contract Trap 8).
 */
export const PRODUCT_IMPORT_FIELDS = [
  "name",
  "barcode",
  "category",
  "unit",
  "costPrice",
  "sellingPrice",
  "quantity",
  "lowStockThreshold",
  "trackStock",
  "description",
] as const;

/** One of the ten fields above. A typo is a compile error, not a silent 422. */
export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];

/**
 * `{ productField: fileHeader | null }`, with **all ten keys always present**.
 *
 * `null` means "no file column feeds this field" — it is the real wire value
 * here, unlike everywhere else in this API where absence is how nothing is
 * expressed. There is no "required" flag on any of them: requiredness is
 * enforced per row at validation time, and the practical minimum for a `ready`
 * row is a mapped `name`, `costPrice` and `sellingPrice` with non-blank cells.
 */
export type ImportColumnMap = Record<ProductImportField, string | null>;

/**
 * The four row-status tallies the server recomputes after **every** mutation
 * (`product-import.service.ts:366,389,409,534`).
 *
 * Only `PATCH /columns` returns the job that carries them; the three row
 * endpoints answer with the row alone, so after any row write the `counts` in
 * hand are stale (Trap 17). That is what
 * `features/product-import/hooks/use-import-mutations.ts` invalidates for.
 */
export interface ImportCounts {
  ready: number;
  needsAttention: number;
  conflict: number;
  skipped: number;
}

/** What a commit wrote. Present on the job only once `status === "committed"`. */
export interface ImportResultCounts {
  /** `ready` rows turned into new products. */
  created: number;
  /** `conflict` rows resolved `"update"`. */
  updated: number;
  /** `skipped` rows **plus** conflict rows resolved `"skip"`. */
  skipped: number;
}

/**
 * A job as `publicJobSummary` shapes it — what `GET /products/import` returns
 * per row, and the base of every detail response.
 *
 * **Not on the wire, though the model holds them:** `organizationId`,
 * `createdBy` and `rows`. `createdBy` is the uploading Member's id
 * (`import-job.model.ts:79,151`) and the shaper never maps it, so an
 * "uploaded by" column **cannot be built from this endpoint** — there is no id
 * to join on.
 */
export interface ImportJobSummary {
  id: ObjectId;
  status: ImportJobStatus;
  /** The original upload name, truncated to 255 chars. Display only. */
  filename: string;
  /**
   * As **detected**, never as declared. The server sniffs `PK\x03\x04` magic
   * bytes first and falls back to the `.xlsx` extension; everything else —
   * including a `.xls`, a `.pdf` or an extensionless file — is parsed as CSV
   * (`../Backend/src/services/import/parse.ts:22-27`). The declared multipart
   * mimetype is stored and then never read.
   */
  format: "csv" | "xlsx";
  columnMap: ImportColumnMap;
  /** File headers no field claimed. Recomputed on every remap. */
  unmatchedHeaders: string[];
  /** Data rows parsed, header excluded. Can be lower than what Excel shows: an
   *  xlsx row whose every mapped cell is blank is dropped (`parse.ts:151-158`). */
  totalRows: number;
  counts: ImportCounts;
  /** Absent before commit. ISO 8601. */
  committedAt?: string;
  /** Absent before commit. Created ids first, then updated ids. */
  committedProductIds?: ObjectId[];
  /** Absent before commit. */
  result?: ImportResultCounts;
  /**
   * ISO 8601, always present, and **absolute**: `createdAt + 7 days`, set once
   * at upload and never advanced (`product-import.service.ts:241`,
   * `import-job.model.ts:175-179`).
   *
   * The TTL index has no `partialFilterExpression`, so it applies to
   * `committed` jobs too — a receipt's `result` and `committedProductIds`
   * vanish 7 days after the **upload**, not after the commit. The products
   * survive; the record of which import made them does not. Do not build a
   * permanent import history on this collection, and do not render "expires in
   * N days" as though reviewing extended it (Trap 12).
   *
   * Mongo's TTL monitor runs roughly every 60 s, so a job can still be readable
   * for up to a minute past this instant. Treat `expiresAt < now` as "expect a
   * 404 at any moment", not as a guarantee of one.
   */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The cleaned, validated product shape staged on a row
 * (`import-job.model.ts:17-33`). **Every field is optional** — a mid-review row
 * can be missing the fields that make a product valid, which is exactly what
 * `needs_attention` means.
 *
 * `category` and `categoryId` are different keys with different meanings and
 * both can be present: `category` is the **name as read from the file**,
 * `categoryId` is the id it resolved to, and only `categoryId` ever reaches the
 * product (`product-import.service.ts:463-466`). An unknown name keeps
 * `category`, drops `categoryId`, and is **not an error** — the row stays
 * `ready` and gains a `note` saying the category will be created on commit.
 */
export interface ImportRowParsed {
  name?: string;
  barcode?: string;
  /** The category NAME as the file spelled it. */
  category?: string;
  /** The resolved id, absent while the name is unknown. A bare string. */
  categoryId?: ObjectId;
  unit?: string;
  /** Main currency, 2 dp. No currency code on the wire. */
  costPrice?: number;
  /** Main currency, 2 dp. No currency code on the wire. */
  sellingPrice?: number;
  trackStock?: boolean;
  /** Up to 3 dp. */
  quantity?: number;
  lowStockThreshold?: number;
  description?: string;
}

/** The two decisions `POST /rows/:index/resolve` accepts. There is no third. */
export type ImportConflictResolution = "skip" | "update";

/**
 * A barcode collision with a product that **already exists in this
 * organization** — not with another row of the same file, which is a
 * `needs_attention` with `errors.barcode` instead.
 *
 * `resolution` is absent until the user decides. Choosing one does **not**
 * change `status`, and any later `PATCH` on the row silently discards it:
 * `editRow` sets `row.conflict = undefined` before re-reconciling, and the
 * reconcile pass re-creates the conflict with **no resolution**
 * (`product-import.service.ts:386,178`). Re-ask after every edit to a
 * conflicted row.
 */
export interface ImportRowConflict {
  existingProductId: ObjectId;
  existingName: string;
  resolution?: ImportConflictResolution;
}

/** One staged row, as `publicRow` shapes it. */
export interface ImportRow {
  /**
   * **0-based** position in the file's data rows, header excluded, and stable
   * for the job's life (`import-job.model.ts:43-44`). It is also the `:index`
   * path segment of the three row endpoints.
   *
   * The server's own duplicate message quotes these raw — `"Duplicated in the
   * file (rows 3, 4)"` means indexes 3 and 4, i.e. spreadsheet rows 5 and 6
   * (Trap 6). Use `spreadsheetRowNumber` before showing a row number to a
   * person.
   */
  index: number;
  /**
   * The row exactly as read, keyed by the **original file header**. Survives
   * every remap — it is what a remap re-derives `parsed` from — so this is the
   * only place the user's own words are still available.
   */
  raw: Record<string, string>;
  parsed: ImportRowParsed;
  status: ImportRowStatus;
  /**
   * Field name to message; `{}` when the row is fine. Three unrelated causes
   * land here and are distinguishable only by reading the keys: a failed field
   * validation, a barcode duplicated **within the file**, and — only ever after
   * a refused commit — `category: "Unknown category"`.
   *
   * The messages are zod-generated and change with a zod upgrade. Display them;
   * never string-match them.
   */
  errors: Record<string, string>;
  /**
   * Non-blocking information, **never an error** (`import-job.model.ts:52-60`).
   * A row carrying "Category X does not exist yet" is `ready`, not
   * `needs_attention`.
   */
  notes: string[];
  /** Absent when there is no conflict. Possibly stale on a row whose `status`
   *  is not `"conflict"` — key the UI off `status`, not off this key's
   *  presence (contract §14, unverified). */
  conflict?: ImportRowConflict;
}

/**
 * What `POST /products/import` and `GET /products/import/:id` both answer: a
 * summary with one page of rows spliced in.
 *
 * **`rowsMeta` lives inside `data`, not in the envelope's `meta`** — these two
 * endpoints have no envelope `meta` at all, while `GET /products/import` uses
 * the envelope and has no `rowsMeta` (Trap 4). `apiGet` therefore returns this
 * whole object, and `apiGetList` is only right for the job list.
 *
 * `rowsMeta.total` is the count **after** the status filter, not `totalRows`:
 * `?status=skipped` on a job with nothing skipped gives `total: 0` and
 * `totalPages: 0`.
 */
export interface ImportJobDetail extends ImportJobSummary {
  rows: ImportRow[];
  rowsMeta: PageMeta;
}

/**
 * What `POST /products/import/:id/commit` answers — and note what it is **not**:
 * the job. After a commit, re-read `GET /:id` to see `status: "committed"` with
 * `result` populated.
 *
 * `productIds` is created ids first, then updated ids, so its length is
 * `created + updated` and **not** `totalRows`.
 */
export interface CommitImportResult {
  result: ImportResultCounts;
  productIds: ObjectId[];
}

/**
 * `GET /products/import` — pagination and **nothing else**. The query schema is
 * `paginationQuerySchema.strict()`
 * (`product-import.validation.ts:7`), so `?status=` on the *list* is a 422: the
 * status filter exists only on `GET /:id`, and it filters rows rather than jobs.
 *
 * `limit` is capped at 100 here, the usual ceiling.
 */
export type ImportJobListParams = PaginationParams;

/**
 * `GET /products/import/:id` — one page of one job's rows.
 *
 * Filtering and paging happen **in memory over the whole loaded document**
 * (`product-import.service.ts:264-267`), so `limit` bounds what crosses the
 * wire, not what the server reads.
 */
export interface ImportRowPageParams {
  status?: ImportRowStatusFilter;
  page?: number;
  /** Capped at **200** here, not the usual 100 — see `MAX_IMPORT_ROW_LIMIT`. */
  limit?: number;
}

/**
 * The same three parameters with every default filled in.
 *
 * Query keys have to be byte-stable to be invalidatable, and `{}`,
 * `{ page: 1 }` and `{ status: "all", page: 1, limit: 20 }` all describe the
 * same request while hashing to three different keys. Resolving the server's
 * own defaults on this side collapses them to one, which is why
 * `resolveImportRowParams` exists and why both the query key and the request
 * are built from its output.
 */
export interface ResolvedImportRowPageParams {
  status: ImportRowStatusFilter;
  page: number;
  limit: number;
}

/** The row page size the server defaults to (`product-import.validation.ts:15`). */
export const DEFAULT_IMPORT_ROW_LIMIT = 20;

/**
 * **200, not the 100 every other list endpoint caps at**
 * (`product-import.validation.ts:15` vs `common.validation.ts:29`). `?limit=201`
 * is a 422. A shared `PAGE_SIZE_MAX = 100` would under-fetch by half on the one
 * endpoint where the headroom matters most — a 2,000-row review (Trap 13).
 */
export const MAX_IMPORT_ROW_LIMIT = 200;

/**
 * Fills in the server's defaults for `GET /:id`
 * (`product-import.validation.ts:11-17`). Idempotent, so it is safe to call on
 * an already-resolved object — which is what lets the query key and the request
 * be built from the same call without the two ever disagreeing.
 */
export const resolveImportRowParams = (
  params: ImportRowPageParams = {},
): ResolvedImportRowPageParams => ({
  status: params.status ?? "all",
  page: params.page ?? 1,
  limit: params.limit ?? DEFAULT_IMPORT_ROW_LIMIT,
});

/** The one multipart field name `upload.single("file")` reads. Any other name
 *  is a 422 (`../Backend/src/middleware/import-upload.middleware.ts:21,31`). */
export const IMPORT_FILE_FIELD = "file";

/**
 * `MAX_IMPORT_BYTES` — 5 MB, enforced by multer
 * (`import-upload.middleware.ts:6`, `parse.ts:10`). Over it is a **413**
 * `IMPORT_FILE_TOO_LARGE`, a deliberately different code from the image
 * uploader's `FILE_TOO_LARGE`. Multer aborts the stream, so the bytes are on
 * the wire before the refusal arrives — checking in the browser first is what
 * saves someone on a phone connection a pointless round trip.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * `MAX_IMPORT_ROWS` — 2,000 **data** rows, header excluded (`parse.ts:7`).
 * Over it is a 422 `IMPORT_TOO_MANY_ROWS`. Nothing client-side can count rows
 * in an xlsx without parsing it, so this is a message, not a pre-check.
 */
export const MAX_IMPORT_ROWS = 2000;

/**
 * `expiresAt` is `createdAt` plus this many days, absolutely
 * (`product-import.service.ts:28,241`). See `ImportJobSummary.expiresAt`.
 */
export const IMPORT_EXPIRY_DAYS = 7;

/**
 * The `accept` attribute for the file input — **a UX choice of ours, not a
 * mirror of a server rule.**
 *
 * The multer instance is built with **no `fileFilter`**
 * (`import-upload.middleware.ts:6`): there is no MIME allow-list and no
 * extension check on the way in. Format is decided later by sniffing, and
 * **CSV is the fall-through rather than a match** — a `.txt`, a `.pdf`, a
 * `.jpg` or an extensionless file is parsed as CSV and usually dies at
 * `IMPORT_NO_ROWS`. A `.xls` does too, which is a baffling message for a real
 * spreadsheet. So never tell the user "only CSV and XLSX are accepted" as if
 * the server said so up front — if you want that sentence, produce it here
 * (Trap 11).
 */
export const IMPORT_ACCEPT_ATTRIBUTE =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * What `GET /products/import/template` sends back, unwrapped by hand.
 *
 * It is one of the two endpoints in this slice that do not speak JSON, so it
 * cannot go through the shared axios client at all — see
 * `services/import.service.ts`.
 */
export interface ImportTemplateFile {
  /** From the server's own `Content-Disposition`, hard-coded to match it. */
  filename: string;
  /** Raw `text/csv`: ten headers and two example rows, CRLF-joined. */
  csv: string;
}

/** `Content-Disposition: attachment; filename="…"`
 *  (`product-import.controller.ts:216`). */
export const IMPORT_TEMPLATE_FILENAME = "tradeos-products-template.csv";

/**
 * The template's header line, asserted verbatim by a backend test
 * (`tests/integration/products/import.test.ts:186`), so it is safe to show in a
 * "your file should look like this" hint without fetching the file.
 *
 * These ten headers are chosen to round-trip through `matchColumns`, so a
 * filled-in template maps all ten fields with no remap step.
 */
export const IMPORT_TEMPLATE_HEADERS = [
  "Name",
  "Barcode",
  "Category",
  "Unit",
  "Cost Price",
  "Selling Price",
  "Quantity",
  "Low Stock",
  "Track Stock",
  "Description",
] as const;
