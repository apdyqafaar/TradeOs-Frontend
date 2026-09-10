# Product import — API contract

Extracted read-only from `Backend` (no edits made there). Every claim below carries a
`file:line` against that repo as of this read. Chain traced:
`src/routes/v1/product-import.route.ts` -> `src/controller/product-import.controller.ts` ->
`src/services/product-import.service.ts` -> `src/db/actions/import-job.actions.ts` ->
`src/db/models/import-job.model.ts`, plus `src/validators/product-import.validation.ts`,
`src/services/import/{columns,parse,clean}.ts`,
`src/middleware/import-upload.middleware.ts`, `src/util/responses.ts`, `src/util/errors.ts`,
`src/middleware/error.middleware.ts`.

Tests read: `tests/integration/products/import.test.ts` (696 lines),
`tests/unit/import-parse.test.ts`, `tests/unit/import-columns.test.ts`,
`tests/unit/import-clean.test.ts`.

Two behavioural claims in this document were **executed against the repo's own zod 4.4.3**
rather than read — they are marked "verified by execution" where they appear, and the exact
command is reproduced in §11 so you can re-run it.

Base prefix: `/api/v1` (`Backend/src/app.ts:54`). The import router is mounted at
`/products/import` **before** `/products` (`Backend/src/routes/v1/index.ts:37-38`) — that
ordering is load-bearing: `productRouter` has a `GET /products/:id` that would otherwise
swallow `/products/import/:id`, and `"import"` is not a valid ObjectId, so the request would
422 instead of ever reaching this router (comment at `index.ts:32-36`).

---

## 0. The endpoint list — there are **ten**, not six

| # | Method | Path | Permission | Success |
|---|---|---|---|---|
| 1 | `POST` | `/api/v1/products/import` | `products:create` | `201` job + first 20 rows |
| 2 | `GET` | `/api/v1/products/import/template` | `products:create` | `200` raw `text/csv` |
| 3 | `GET` | `/api/v1/products/import` | `products:create` | `200` paginated summaries |
| 4 | `GET` | `/api/v1/products/import/:id` | `products:create` | `200` job + one page of rows |
| 5 | `PATCH` | `/api/v1/products/import/:id/columns` | `products:create` | `200` job summary |
| 6 | `PATCH` | `/api/v1/products/import/:id/rows/:index` | `products:create` | `200` one row |
| 7 | `DELETE` | `/api/v1/products/import/:id/rows/:index` | `products:create` | `200` one row (now `skipped`) |
| 8 | `POST` | `/api/v1/products/import/:id/rows/:index/resolve` | `products:create` | `200` one row |
| 9 | `POST` | `/api/v1/products/import/:id/commit` | `products:create` (+ see §7) | `200` commit result |
| 10 | `DELETE` | `/api/v1/products/import/:id` | `products:create` | `204` no body |

Routes: `product-import.route.ts:48-57, 63-70, 72-79, 81-88, 90-97, 99-106, 108-115, 117-124,
126-133, 135-142`.

**Every one of the ten gates on the same single permission: `PERMISSIONS.PRODUCTS_CREATE`
= `"products:create"`** (`product-import.route.ts:52,68,77,86,95,104,113,122,131,140`; the
constant is `Backend/src/lib/permissions.ts:30`). There is no separate "import" permission.
Commit reads two *further* permissions but does not gate the route on them — see §7.

`requirePermission` passes when the role holds the literal string **or** the `"*"` wildcard
(`Backend/src/lib/permissions.ts:98-99`; middleware `src/middleware/auth.middleware.ts:164-171`).
A preset **Seller** role does not hold `products:create` and gets 403
(`tests/integration/products/import.test.ts:157-164`, `229-230`).

### Middleware chain — two different orders

Nine of the ten routes run `validate` **first**:

```
validate({params?, query?, body}) -> requireAuth -> requireMember -> requirePermission(products:create) -> handler
```

`POST /` is the recorded exception (`product-import.route.ts:35-47`):

```
requireAuth -> requireMember -> requirePermission(products:create)
  -> rateLimit({name:"product-import", windowMs:900000, max:20, keyBy:"organization"})
  -> singleImportFileUpload (multer)
  -> validate({ body: noBodySchema })
  -> createImportJob
```

**Where multer sits, and why.** `singleImportFileUpload` is the *fifth* link — after
`requirePermission` and after the rate limiter (`product-import.route.ts:52-54`). The reason
the source itself gives (`product-import.route.ts:35-47`, mirroring the identical recorded
exception in `src/routes/v1/upload.route.ts:24-33`) is mechanical and two-part:

1. the body is `multipart/form-data`, so `validate({ body })` has literally nothing on
   `req.body` to parse until multer has consumed the stream — hence `validate` moved to *last*
   rather than first;
2. `keyBy: "organization"` needs `requireMember` to have resolved the tenant before the
   limiter can compute its bucket key (`src/middleware/rate-limit.middleware.ts:134-137`; the
   requirement is stated at `rate-limit.middleware.ts:29-31`).

A third consequence follows from the same ordering but is **not** stated in the source, so
treat it as my inference rather than a documented intent: a caller who fails
`requirePermission` or the rate limiter is rejected *before* multer buffers anything, so an
unauthorised 5 MB upload never reaches `multer.memoryStorage()`
(`src/middleware/import-upload.middleware.ts:6`).

The practical frontend consequence of the split is asymmetric and is a real trap:

- On `POST /` an anonymous caller gets **401** (`import.test.ts:166-169`).
- On the other nine, `validate` runs before `requireAuth`, so an anonymous caller with a
  malformed id, index, body or query gets **422**, not 401. `validate` throws before auth is
  ever consulted (`src/middleware/validate.middleware.ts:80`). This is the same "Trap 0"
  recorded in `sales.md` and `debts.md` for their routers.

---

## 1. `POST /products/import` — create a job by uploading a file

Route `product-import.route.ts:48-57`. Controller `createImportJob`,
`product-import.controller.ts:69-90`.

### How the file is sent

- **Multipart field name is exactly `file`** — `upload.single("file")`
  (`src/middleware/import-upload.middleware.ts:21`). Any other field name produces a multer
  error, which this middleware converts to **422** with
  `errors: { file: "Expected a single multipart file field named 'file'" }`
  (`import-upload.middleware.ts:31`).
- **At most one file**: `limits: { files: 1 }` (`import-upload.middleware.ts:6`). A second file
  is also the generic 422 above.
- **No other multipart fields are allowed.** `validate({ body: noBodySchema })` runs after
  multer (`product-import.route.ts:55`), and `noBodySchema` is
  `z.object({}).strict().optional()` (`src/validators/common.validation.ts:21`) — a file-only
  post leaves `req.body` as `{}` which passes, but any text field you smuggle alongside the
  file is a **422 `VALIDATION_ERROR`**. The route comment says this explicitly
  (`product-import.route.ts:43-47`).
- **Size ceiling: 5 MB.** `MAX_IMPORT_BYTES = 5 * 1024 * 1024`
  (`src/services/import/parse.ts:10`), wired into multer at `import-upload.middleware.ts:6`.
  Exceeding it is **413** with code **`IMPORT_FILE_TOO_LARGE`** and message
  `"Import files must be 5 MB or smaller"` (`import-upload.middleware.ts:23-29`; proven
  `import.test.ts:130-143`). Note this is a *different* code from the image-upload middleware's
  `FILE_TOO_LARGE` (`src/middleware/upload.middleware.ts:24`), deliberately so
  (`import-upload.middleware.ts:13-18`).
- **Row ceiling: 2,000 data rows** (header excluded). `MAX_IMPORT_ROWS = 2000`
  (`parse.ts:7`), enforced in `finalize` (`parse.ts:60`) as **422 `IMPORT_TOO_MANY_ROWS`**,
  message `"Too many rows"`, `errors.file = "A file may contain at most 2000 rows"`
  (`parse.ts:45-51`; proven `tests/unit/import-parse.test.ts:27-35`).

### MIME types and extensions — **nothing is filtered**

This is the single most likely wrong guess. The multer instance is constructed with **no
`fileFilter`** at all:

```ts
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });
```
(`src/middleware/import-upload.middleware.ts:6`)

So there is **no allow-list of MIME types and no extension check on the way in**. The declared
`Content-Type` of the part is stored on `req.file.mimetype` and handed to the service
(`product-import.controller.ts:76`) — and then the service **never reads it**
(`product-import.service.ts:216` passes only `buffer` and `originalname` onward). Format is
decided by sniffing:

```ts
export const detectImportFormat = (buffer: Buffer, filename: string): "csv" | "xlsx" => {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC)) return "xlsx";
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") return "xlsx";
  return "csv";
};
```
(`src/services/import/parse.ts:22-27`, `ZIP_MAGIC` = `PK\x03\x04` at `parse.ts:15`)

Consequences you must design the picker around:

- Magic bytes win over the extension; the declared mimetype is never consulted alone
  (`parse.ts:17-21`).
- **`csv` is the fall-through, not a match.** Anything that is not a zip and does not end
  `.xlsx` — a `.txt`, a `.pdf`, a `.jpg`, a file with no extension — is parsed as CSV. It will
  usually die at `IMPORT_NO_ROWS` (`parse.ts:37-43,59`) rather than
  `IMPORT_UNSUPPORTED_FORMAT`.
- `.xls` (the old binary format) is **not** supported: no zip magic, extension isn't `xlsx`, so
  it is read as CSV and fails as garbage. There is no code path that produces a friendly
  message for it.
- A `.docx` shares the zip signature, so it routes to the xlsx parser, where `exceljs` rejects
  it as **422 `IMPORT_UNSUPPORTED_FORMAT`** (`parse.ts:120-131`, `29-35`; proven
  `tests/unit/import-parse.test.ts:53-64`).

A sensible client-side `accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`
is **your** UX choice, not a mirror of a server rule. Do not tell the user "only CSV and XLSX
are accepted" as if the server enforces it up front — it enforces it at parse time, with
different codes.

### Other parse-time refusals on this endpoint

| Condition | Status | `code` | Where |
|---|---|---|---|
| No `file` part at all reached the handler | 422 | `VALIDATION_ERROR`, `errors.file = "A file is required"` | `product-import.controller.ts:71` |
| 0 headers or 0 data rows (empty file, header-only file) | 422 | `IMPORT_NO_ROWS` | `parse.ts:37-43`, thrown `parse.ts:59` |
| >2,000 data rows | 422 | `IMPORT_TOO_MANY_ROWS` | `parse.ts:45-51,60` |
| zip-shaped but not a workbook, or a workbook with no first sheet | 422 | `IMPORT_UNSUPPORTED_FORMAT` | `parse.ts:29-35,129-134` |
| 21st upload in 15 min per **organization** | 429 | `TOO_MANY_REQUESTS` | `product-import.route.ts:53`; proven `import.test.ts:145-155` |

The 429 also sets a **`Retry-After`** header in seconds
(`src/middleware/rate-limit.middleware.ts:166`) and the message is
`"Too many attempts. Try again in N seconds."` (`rate-limit.middleware.ts:167`). The limiter is
**per organization, not per user** (`keyBy: "organization"`,
`product-import.route.ts:53`) — twenty uploads across the whole business, not per member. It is
also **in-process memory** and resets on server restart (`rate-limit.middleware.ts:41-57`).

### Parsing details a reviewer UI will surface

- CSV: `papaparse` with `header: true`, `skipEmptyLines: true`, headers trimmed; a leading
  UTF-8 BOM is stripped by hand (`parse.ts:64-83`; BOM+CRLF proven
  `tests/unit/import-parse.test.ts:6-19`). Every cell is coerced to a trimmed string
  (`parse.ts:78`).
- XLSX: **only `workbook.worksheets[0]` is read**; a second sheet is silently ignored, never
  merged and never reported (`parse.ts:117-119,133`; proven
  `tests/unit/import-parse.test.ts:39-51`). Row 1 is the header row (`parse.ts:144-147`). A
  data row where every mapped cell is blank is dropped entirely (`parse.ts:151-158`), so
  `totalRows` can be lower than the row count the user sees in Excel.
- Cell coercion: dates become ISO strings, rich text is its runs joined, a formula becomes its
  **cached result** (formulas are never executed), a hyperlink cell becomes its display text,
  anything else becomes `""` (`parse.ts:105-115`).

### Response — `201`

`createdResponse` (`src/util/responses.ts:47-48`) wraps `successResponse`
(`responses.ts:31-45`), so the envelope is `{ success, message, data }` with
`message: "Import job created"` (`product-import.controller.ts:85`). The `data` object is
`publicJobSummary(job)` spread, plus two extra keys:

```jsonc
{
  "success": true,
  "message": "Import job created",
  "data": {
    // ...every key of publicJobSummary (see §5)
    "rows": [ /* publicRow, FIRST 20 ONLY */ ],
    "rowsMeta": { "page": 1, "limit": 20, "total": 6, "totalPages": 1 }
  }
}
```

`product-import.controller.ts:79-89`. **`limit` here is the hardcoded literal `20`
(`controller.ts:80`) and `page` is the hardcoded literal `1` (`controller.ts:88`)** — there is
no query parameter on `POST /` that can change either. To see rows 21+ you must call
`GET /:id` (§4). `rowsMeta` lives **inside `data`**, not in the envelope's `meta` — see Trap 4.

---

## 2. `GET /products/import/template`

Route `product-import.route.ts:63-70`. It is declared **before** `/:id`; the route comment
explains that Express would otherwise try `"template"` as an ObjectId and 422
(`product-import.route.ts:59-62`).

`validate({ query: noBodySchema, body: noBodySchema })` (`route.ts:65`) — `noBodySchema` is
`.strict()`, so **any query string at all on this URL is a 422**, and because `validate` is
first, that 422 outranks a missing session.

Handler `getImportTemplate`, `product-import.controller.ts:213-218`. It **does not use the JSON
envelope**: it sets `Content-Type: text/csv` and
`Content-Disposition: attachment; filename="tradeos-products-template.csv"` and sends a raw
string body (`controller.ts:215-217`; proven `import.test.ts:177-187`).

Content: ten canonical headers plus two example rows, joined with `,` and `\r\n`
(`controller.ts:214`):

```
Name,Barcode,Category,Unit,Cost Price,Selling Price,Quantity,Low Stock,Track Stock,Description
Bottled Water 500ml,BW-500,Drinks,pcs,0.30,0.50,100,20,yes,Case of 24 bottles
Delivery Fee,,Services,pcs,0,5.00,0,,no,Standard delivery within the city
```
(`controller.ts:195-211`)

The headers are chosen so a filled-in template round-trips through `matchColumns`
(`controller.ts:191-194`). Fetch it with a normal `<a download>` / `fetch` + blob — do **not**
run it through your JSON API client, there is no `{success,...}` wrapper.

---

## 3. `GET /products/import` — list jobs

Route `product-import.route.ts:72-79`. Query schema: `importJobsQuerySchema =
paginationQuerySchema.strict()` (`src/validators/product-import.validation.ts:7`).

| param | type | default | source |
|---|---|---|---|
| `page` | coerced int, ≥ 1 | **`1`** | `common.validation.ts:28` |
| `limit` | coerced int, 1..**100** | **`20`** | `common.validation.ts:29` |

`.strict()` means **`?status=` on the list endpoint is a 422**, not an ignored key — the status
filter exists only on `GET /:id`. Both defaults fire (verified by execution: `{}` parses to
`{page:1, limit:20}`).

Service `listImportJobs` (`product-import.service.ts:245-254`) -> action
`findImportJobsByOrganization` (`src/db/actions/import-job.actions.ts:31-39`):
`.select("-rows")`, sorted `{ createdAt: -1, _id: -1 }`, skip/limit. **Rows are stripped at the
database layer**, so `data[i].rows` is `undefined` on this endpoint (proven
`import.test.ts:209`).

Response — `paginatedResponse` (`responses.ts:52-61`), message `"Import jobs fetched"`
(`product-import.controller.ts:98`):

```jsonc
{
  "success": true,
  "message": "Import jobs fetched",
  "data": [ /* publicJobSummary, no `rows` key */ ],
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

Note the shape asymmetry: **the list uses the envelope `meta`; the detail uses
`data.rowsMeta`.**

---

## 4. `GET /products/import/:id` — read one job + a page of rows

Route `product-import.route.ts:81-88`.

Params: `importJobIdParamSchema = z.object({ id: objectIdSchema }).strict()`
(`validation.ts:19`), `objectIdSchema` = `/^[0-9a-fA-F]{24}$/`
(`common.validation.ts:5-7`). A non-24-hex id is 422 `VALIDATION_ERROR`, before auth.

Query: `importJobRowsQuerySchema` (`validation.ts:11-17`) — `.strict()`:

| param | type / values | default | source |
|---|---|---|---|
| `status` | `"ready" \| "needs_attention" \| "conflict" \| "skipped" \| "all"` | **`"all"`** | `validation.ts:13` |
| `page` | coerced int, ≥ 1 | **`1`** | `validation.ts:14` |
| `limit` | coerced int, 1..**200** | **`20`** | `validation.ts:15` |

**The row `limit` cap is 200, not the usual 100** (`validation.ts:15`, comment at
`validation.ts:9-10`). `?limit=201` is 422 (proven `import.test.ts:218-219`).

Filtering and paging happen **in memory over the whole loaded document**, not in the database:
`job.rows.filter(...)` then `.slice(start, start + limit)`
(`product-import.service.ts:264-267`). The full 2,000-row document is loaded on every call
(`findImportJobById`, `import-job.actions.ts:23-27`) regardless of `limit` — that is a
server-side cost, but from the wire you only ever receive `limit` rows.

Tenant scoping is on the query itself: `ImportJob.findOne({ _id: id, organizationId })`
(`import-job.actions.ts:27`), and a miss throws `NotFoundError("Import job")` — **404**, code
`NOT_FOUND`, message `"Import job not found"`
(`product-import.service.ts:262`; `src/util/errors.ts:77-88`). Another organization's job id is
therefore 404, not 403 (proven `import.test.ts:221-224`).

Response — `successResponse(..., 200, ...)`, message `"Import job fetched"`
(`product-import.controller.ts:112-121`):

```jsonc
{
  "success": true,
  "message": "Import job fetched",
  "data": {
    // ...publicJobSummary
    "rows": [ /* publicRow, the filtered page */ ],
    "rowsMeta": { "page": 1, "limit": 20, "total": 4, "totalPages": 1 }
  }
}
```

`rowsMeta.total` is the count **after** the status filter, not `totalRows`
(`service.ts:265`, `controller.ts:115-120`). With `?status=skipped` on a job with no skipped
rows you get `total: 0` and `totalPages: 0`.

This endpoint works on `committed` and `cancelled` jobs too — only the *mutating* endpoints
require `reviewing` (§8).

---

## 5. Response shapes

### `publicJobSummary` — `product-import.controller.ts:52-67`

| key | type on the wire | notes |
|---|---|---|
| `id` | `string` | **`job.id`**, the Mongoose virtual — the wire key is `id`, **not `_id`** (`controller.ts:53`) |
| `status` | `"reviewing" \| "committed" \| "cancelled"` | `import-job.model.ts:11` |
| `filename` | `string` | the original upload name, truncated to 255 chars, **display only** (`service.ts:234`, `model.ts:81,158`) |
| `format` | `"csv" \| "xlsx"` | as *detected*, not as declared (`model.ts:12`, `parse.ts:22-27`) |
| `columnMap` | `Record<string, string \| null>` | always all ten product fields as keys — see §6 |
| `unmatchedHeaders` | `string[]` | file headers not mapped to any field |
| `totalRows` | `number` | data rows parsed, header excluded |
| `counts` | `{ ready, needsAttention, conflict, skipped }` all `number` | `model.ts:64-69`; note **`needsAttention` is camelCase here while the row status string is `needs_attention` snake_case** |
| `committedAt` | ISO date `string`, **key absent** before commit | `model.ts:90`; `undefined` is dropped by `res.json` |
| `committedProductIds` | `string[]`, **key absent** before commit | `controller.ts:62` maps ObjectIds to strings via `?.map` |
| `result` | `{ created, updated, skipped }` all `number`, **key absent** before commit | `model.ts:71-75` |
| `expiresAt` | ISO date `string` | always present — see §9 |
| `createdAt` | ISO date `string` | Mongoose timestamps (`model.ts:170`) |
| `updatedAt` | ISO date `string` | |

**Not on the wire, though it exists in the model:** `organizationId`, `createdBy` (the Member
id of the uploader), and `rows` (added separately by the two detail controllers).
`createdBy` is stored (`model.ts:79,151`) but never mapped — so a "uploaded by Amina" column in
the jobs list **cannot be built from this endpoint**; you would need a separate members fetch
and an id you do not have.

### `publicRow` — `product-import.controller.ts:36-50`

| key | type | notes |
|---|---|---|
| `index` | `number` | **0-based** position in the file, stable for the job's life (`model.ts:43-44`) |
| `raw` | `Record<string, string>` | the row exactly as read, keyed by the **original file header**; survives every remap (`model.ts:45-47`) |
| `parsed` | `IImportRowParsed` | the cleaned/validated product shape — see below |
| `status` | `"ready" \| "needs_attention" \| "conflict" \| "skipped"` | `model.ts:10` |
| `errors` | `Record<string, string>` | field -> message; `{}` when the row is fine (`model.ts:50-51`) |
| `notes` | `string[]` | non-blocking info, **never an error** (`model.ts:52-60`) |
| `conflict` | `{ existingProductId: string, existingName: string, resolution?: "skip" \| "update" }` — **key absent** when there is no conflict | `controller.ts:43-49`; `existingProductId` is `.toString()`'d, so a string |

`parsed` (`model.ts:17-33`) — every field optional, because a mid-review row may be missing
required fields entirely:

`name?: string`, `barcode?: string`, `category?: string` (the **NAME** as read from the file),
`categoryId?: string` (the **resolved id**, absent while the name is unknown),
`unit?: string`, `costPrice?: number`, `sellingPrice?: number`, `trackStock?: boolean`,
`quantity?: number`, `lowStockThreshold?: number`, `description?: string`.

`parsed` carries **both** `category` (name) and `categoryId` (resolved id) — they are different
keys with different meanings, and only `categoryId` reaches the product
(`service.ts:463-466`).

A row that passes validation has had `createProductSchema`'s defaults applied to `parsed`, so
after a successful validation `parsed` always contains `unit`, `trackStock` **and
`quantity: 0`** even when the file had none of them (verified by execution — see §11:
`validateRow({name:"x",costPrice:1,sellingPrice:2,unit:"pcs",trackStock:true})` returns
`{...,"quantity":0}`).

### Job status enum — `import-job.model.ts:11,152-157`

| value | meaning | set where |
|---|---|---|
| `reviewing` | the working state; the **only** state in which endpoints 5–10 will act | `service.ts:233` at creation, model default `model.ts:156` |
| `committed` | products have been written; the job is now a read-only receipt with `committedAt`, `committedProductIds`, `result` | `service.ts:656-659` |
| `cancelled` | the user abandoned it; nothing was written | `service.ts:443` |

There is **no** `parsing`/`processing`/`failed` status — parsing is synchronous inside the
upload request, so a job either exists as `reviewing` or the `POST` itself failed. Do not build
a polling loop.

---

## 6. The column map

### Alias matching — `src/services/import/columns.ts`

The ten fields, in this exact order (`columns.ts:8-19`):
`name, barcode, category, unit, costPrice, sellingPrice, quantity, lowStockThreshold,
trackStock, description`.

Header normalisation before lookup: lowercase, strip everything that is not a letter/number/
space (Unicode-aware), collapse runs of whitespace, trim (`columns.ts:52-57`; proven
`tests/unit/import-columns.test.ts:5-7`: `"  Sale   Price! "` -> `"sale price"`).

The alias table (`columns.ts:30-49`), lower-case, matched against the normalised header:

| field | aliases |
|---|---|
| `name` | name, item, item name, product, product name, title, **description** |
| `barcode` | barcode, bar code, sku, upc, ean, code, item code, product code |
| `category` | category, type, group, department |
| `unit` | unit, uom, unit of measure, units |
| `costPrice` | cost, cost price, purchase price, buy price, unit cost |
| `sellingPrice` | price, sale price, sales price, selling price, sell price, retail price, unit price |
| `quantity` | quantity, qty, stock, on hand, quantity on hand, in stock, stock quantity |
| `lowStockThreshold` | low stock, reorder point, reorder level, min stock, minimum |
| `trackStock` | track stock, tracked, inventory, is inventory, track inventory |
| `description` | description, notes, details |

Resolution rules (`columns.ts:87-110`):

- **First match wins.** A header whose field is already taken by an earlier header is pushed to
  `unmatchedHeaders` rather than overwriting (`columns.ts:104-106`; proven
  `import-columns.test.ts:34-38` — `["Name","Item"]` gives `name: "Name"`,
  `unmatchedHeaders: ["Item"]`).
- **`"description"` is deliberately ambiguous.** It goes to `name` if `name` is still unclaimed,
  else to `description`, else to `unmatchedHeaders` (`columns.ts:97-102`). Reason: QuickBooks
  puts the display name in "Description" for service items (`columns.ts:23-29`). Proven
  `import-columns.test.ts:28-32`: `["Description","Price"]` maps `name: "Description"`.
- Order matters: header iteration is left-to-right over the file's own header order
  (`columns.ts:94`).

### On the wire

`columnMap` is `{ productField: fileHeader | null }` with **all ten keys always present**,
seeded to `null` (`columns.ts:88-91`). A `null` means "no file column feeds this field".

The QuickBooks example asserted in the tests (`import.test.ts:32`, `96-102`):

```json
{
  "name": "Item Name", "description": "Description", "sellingPrice": "Sales Price",
  "costPrice": "Cost", "quantity": "Quantity On Hand", "barcode": "SKU",
  "category": null, "unit": null, "lowStockThreshold": null, "trackStock": null
}
```

### Which fields are actually required

There is no "required" flag on `columnMap` anywhere. Requiredness is enforced **per row, at
validation time**, by `importRowSchema` (`src/services/import/clean.ts:14-20`), which is
`createProductSchema` (`src/validators/product.validation.ts:57-67`) minus `images` and the
form's `categoryId`, plus the file's `category` name and a resolved `categoryId`:

| field | required? | rule | source |
|---|---|---|---|
| `name` | **required** | trimmed string, 1..120 | `product.validation.ts:42` |
| `costPrice` | **required** | `moneySchema` — finite, ≥ 0, ≤ 2 decimals | `product.validation.ts:45`, `common.validation.ts:33-35` |
| `sellingPrice` | **required** | same | `product.validation.ts:46` |
| `unit` | effectively always present | 1..20 chars, **`.default("pcs")`** | `product.validation.ts:60` |
| `trackStock` | effectively always present | boolean, **`.default(true)`** | `product.validation.ts:61` |
| `quantity` | effectively always present | `0` or a positive ≤3-dp quantity, **`.default(0)`** | `product.validation.ts:62-65` |
| `barcode` | optional | trimmed, 4..64, `/^[A-Za-z0-9._-]+$/` | `product.validation.ts:15-20,43` |
| `category` | optional | trimmed string, max 60 — the **name** | `clean.ts:17` |
| `lowStockThreshold` | optional | int, 0..1e9 | `product.validation.ts:52` |
| `description` | optional | trimmed, max 2000 | `product.validation.ts:53` |

So the practical minimum for a `ready` row is a mapped `name`, `costPrice` and `sellingPrice`
column with non-blank cells. Everything else can be `null` in the map.

Note `barcode`'s **min length is 4** and its charset excludes spaces — a 3-character SKU or one
containing a space is `needs_attention`, which is easy to miss.

### `PATCH /products/import/:id/columns` — changing the map

Route `product-import.route.ts:90-97`. Body: `columnMapPatchSchema`
(`validation.ts:33-39`):

```ts
z.object({
  columnMap: z.record(z.string(), z.string().min(1).max(200).nullable())
              .refine(m => Object.keys(m).length > 0, "Provide at least one column mapping"),
}).strict()
```

- The patch is a **partial merge**, not a replacement: `{...job.columnMap, ...patch}`
  (`service.ts:304`). Send only the fields you are changing.
- `null` unmaps a field and is always legal (`service.ts:315-316,320`).
- `{ columnMap: {} }` is a 422 (`errors["columnMap"] = "Provide at least one column mapping"`,
  verified by execution).
- The key type is a loose `z.string()` at the zod layer; **the service** rejects a key that is
  not one of `PRODUCT_FIELDS` (`service.ts:298-302`) with
  `ValidationError({ columnMap: 'Unknown product field "foo"' })` — default message
  `"Validation failed"` and **default code `VALIDATION_ERROR`**, *not*
  `IMPORT_UNKNOWN_HEADER`. This asymmetry is real; see Trap 8.
- The **merged** map is validated, not just the patch (`service.ts:306-342`, comment
  `306-316`). Two rejections, both **422 `IMPORT_UNKNOWN_HEADER`** with message
  `"Unknown column"`:
  - a header that is not one of the file's own headers — `errors[field] = '"X" is not a column
    in this file'` (`service.ts:321-328`; proven `import.test.ts:480-496`);
  - the same header claimed by two fields in the merged map — `errors.columnMap = '"X" cannot
    be mapped to both "a" and "b"'` (`service.ts:333-341`; proven `import.test.ts:498-514`
    for a self-colliding patch and `516-550` for a patch colliding with an *existing* mapping).
- The file's real headers are derived from `job.rows[0].raw`'s keys (`service.ts:317`) — every
  row is keyed by the same header set, and `rows` is never empty because `IMPORT_NO_ROWS` fires
  before a job exists (comment `service.ts:310-316`).
- **Nothing is written unless every check passes** — proven twice by re-reading `columnMap`
  after a rejection (`import.test.ts:494-495`, `512-513`, `537-538`).
- Moving a header from one field to another **in one call** works:
  `{ costPrice: null, sellingPrice: "Cost" }` succeeds where `{ sellingPrice: "Cost" }` alone is
  rejected (`import.test.ts:540-547`).
- `unmatchedHeaders` is recomputed as (previously-mapped ∪ previously-unmatched) minus
  now-mapped (`service.ts:344-347`).

**A remap re-derives every non-skipped row from `raw` and destroys manual row edits.**
`service.ts:355-363` overwrites `parsed`, `notes`, `errors`, `status` and clears `conflict` for
every row whose status is not `skipped`. The integration test states this in so many words and
has to redo its edits afterwards (`import.test.ts:328-335`). Warn the user before a remap.

Skipped rows are the only ones left alone (`service.ts:356`).

Response: `200`, message `"Columns remapped"`, `data` = `publicJobSummary(job)` **with no
`rows` and no `rowsMeta`** (`product-import.controller.ts:130`). You must re-fetch `GET /:id`
to see the re-derived rows.

---

## 7. Row states

### The enum — `import-job.model.ts:10`

```ts
export type ImportRowStatus = "ready" | "needs_attention" | "conflict" | "skipped";
```

Exactly four. There is no `pending`, no `error`, no `imported`, no `created`. A row's status
does **not** change after commit — a committed job's rows still read `ready` / `conflict`.

### What puts a row in each state

**`ready`** — `parsed` passed `importRowSchema` and the row has no barcode collision.
Set at build (`service.ts:106`) and confirmed by the file-wide pass (`service.ts:180`).

**`needs_attention`** — three distinct causes, distinguishable only by reading `errors`:

1. *Field validation failed.* `validateRow` returned issues; each zod issue's first path
   segment becomes a key in `errors`, first issue per field wins
   (`clean.ts:190-200`, status `service.ts:106`). Example: a blank Sales Price gives
   `errors.sellingPrice` (`import.test.ts:107-109`; unit-level
   `tests/unit/import-clean.test.ts:71-76`).
2. *Two rows in the same file share a non-empty barcode.* Both are flagged with
   `errors = { barcode: "Duplicated in the file (rows 3, 4)" }`
   (`service.ts:152-155`; proven `import.test.ts:111-116`). See Trap 6 — those numbers are
   0-based indices.
3. *Unknown category at commit time with no `categories:create`.* `errors.category` is set to
   the exact string `"Unknown category"` (`service.ts:45`, applied `service.ts:530-531`;
   proven `import.test.ts:679`).

**`conflict`** — the row's barcode matches an existing **product in this organization**. Set at
`service.ts:176-178` after a single `findProductsByBarcodes` lookup
(`service.ts:161-171`). Carries `conflict.existingProductId` and `conflict.existingName`
(proven `import.test.ts:118-121`).

**`skipped`** — the client called `DELETE /:id/rows/:index`. `status = "skipped"`, `errors`
cleared to `{}`, `conflict` cleared (`service.ts:404-406`).

### What the client may do

| From | Action | Endpoint | Result |
|---|---|---|---|
| any | edit fields | `PATCH /:id/rows/:index` | re-validated; becomes `ready` or `needs_attention`, then the file-wide pass may promote it to `conflict` |
| any | skip | `DELETE /:id/rows/:index` | `skipped` |
| `conflict` | choose a resolution | `POST /:id/rows/:index/resolve` | **stays `conflict`**; only `conflict.resolution` changes |
| `skipped` | *un*-skip | — | **no endpoint exists** (see Trap 9) |

### `PATCH /products/import/:id/rows/:index`

Route `product-import.route.ts:99-106`. Params `importRowParamSchema`
(`validation.ts:21-23`): `id` 24-hex, `index` = `z.coerce.number().int().min(0)`. A
non-integer, negative or non-numeric index is 422 before auth.

Body: `importRowPatchSchema` (`validation.ts:43-47`) =
`importRowSchema.omit({categoryId:true}).partial().strict().refine(len>0)`. Accepted keys:
`name, barcode, category, unit, costPrice, sellingPrice, trackStock, quantity,
lowStockThreshold, description`. **`categoryId` and `images` are rejected as unrecognized keys**
(verified by execution — `{categoryId:"0123456789abcdef01234567"}` returns
`unrecognized_keys`). You change the category by sending its **name** in `category`.

Service `editRow` (`service.ts:372-394`): `merged = { ...row.parsed, ...patch }`, re-validate,
set `parsed`/`errors`/`status`, **clear `conflict`**, then re-run the whole-file reconciliation
(`reconcileRows`, `service.ts:189-192`) and recompute `counts`.

Because reconciliation is file-wide, **fixing one half of a duplicate pair frees the other**:
the test patches one row's barcode and then observes the *other* row flipping to `ready`
without touching it (`import.test.ts:281-291`; the mechanism and its rationale are at
`service.ts:121-131`).

Unknown index -> **404 `IMPORT_ROW_NOT_FOUND`**, message `"Import row not found"`
(`service.ts:287`; proven `import.test.ts:310-315`).

Response: `200`, message `"Row updated"`, `data` = `publicRow(row)` — **one row, not the job**
(`controller.ts:139`). `counts` changed server-side but you do not get them back; re-fetch
`GET /:id` if you display them.

Clearing a category: send `{ category: "" }`. It validates (there is no `.min()` on
`category`, `clean.ts:17`), and `resolveRowCategories` then deletes both `parsed.category` and
`parsed.categoryId` because the trimmed name is falsy (`service.ts:73-79`; proven
`import.test.ts:588-591`).

### `DELETE /products/import/:id/rows/:index`

Route `product-import.route.ts:108-115`, service `skipRow` (`service.ts:396-414`).
Response is **`200` with the row**, message `"Row skipped"` (`controller.ts:148`) — *not* 204.
Proven `import.test.ts:294-298`.

### `POST /products/import/:id/rows/:index/resolve` — the barcode-conflict decision

Route `product-import.route.ts:117-124`. Body: `resolveConflictSchema =
z.object({ resolution: z.enum(["skip","update"]) }).strict()` (`validation.ts:49`).

**Exactly two options, no default, and `resolution` is required** — omitting it is 422
(verified by execution: `Invalid option: expected one of "skip"|"update"`). There is no
`"create"` / `"replace"` / `"ignore"` option and no way to create a second product with the
same barcode (the unique index would refuse it anyway).

| resolution | effect at commit |
|---|---|
| `"update"` | the existing product is patched with the row's **non-blank** fields, and a stock movement is written for any quantity difference (§8) |
| `"skip"` | the row is left alone and counted in `result.skipped` (`service.ts:504-506`) |

Service `resolveConflict` (`service.ts:416-439`): if the row is not `status === "conflict"` or
has no `conflict` object, **422 `IMPORT_ROW_NOT_CONFLICT`**, message
`"This row is not a conflict"`, `errors.resolution` set (`service.ts:425-432`). Otherwise it
sets `row.conflict.resolution` and saves.

**The row's `status` stays `"conflict"` after resolving** — only `conflict.resolution` changes
(proven explicitly: `import.test.ts:305-307` asserts `status === "conflict"` *and*
`conflict.resolution === "update"`). Do not build your "all clear" check on
`counts.conflict === 0`; see Trap 5.

Response: `200`, message `"Conflict resolved"`, `data` = `publicRow(row)`
(`controller.ts:158`).

**Any subsequent `PATCH` on that row silently discards the resolution**, because `editRow` sets
`row.conflict = undefined` (`service.ts:386`) before re-reconciling. The reconcile pass will
re-create `conflict` if the barcode still collides — but with **no `resolution`**
(`service.ts:178`). Re-ask the user after every edit to a conflicted row.

---

## 8. `POST /products/import/:id/commit`

Route `product-import.route.ts:126-133`; `validate({ params, body: noBodySchema })` — send
`{}` or nothing; any body field is 422.

### What it refuses, and why

Controller `commitImport` (`controller.ts:161-181`) reads two extra permissions off the
resolved role before calling the service:

```ts
const canUpdate = hasPermission(permissions, PERMISSIONS.PRODUCTS_UPDATE);        // "products:update"
const canCreateCategories = hasPermission(permissions, PERMISSIONS.CATEGORIES_CREATE); // "categories:create"
```
(`controller.ts:164-167`; constants `src/lib/permissions.ts:31,38`)

Refusals, in the order the service checks them (`service.ts:481-543`):

| # | Condition | Status | `code` | Extra |
|---|---|---|---|---|
| 1 | job status is not `reviewing` | **409** | `IMPORT_NOT_REVIEWING` | message `"This import has already been committed or cancelled"` (`service.ts:279-281`) |
| 2 | `counts.needsAttention > 0` **or** any `conflict` row has no `resolution` | **422** | `IMPORT_NOT_READY` | `errors: {}`, `details: { counts }` (`service.ts:494-501`) |
| 3 | at least one row resolved `"update"` and the caller lacks `products:update` | **403** | `FORBIDDEN` | message `"You do not have permission to update existing products"` (`service.ts:508-510`) |
| 4 | at least one committing row names a category that does not exist **and** the caller lacks `categories:create` | **422** | `IMPORT_NOT_READY` | different message; `details: { counts }` (`service.ts:528-543`) |

Refusal 2 is proven at `import.test.ts:268-271` (with `details.counts` asserted present).
Refusal 3 is proven at `import.test.ts:394-427`, including that it happens **before the
transaction opens** — the existing product is verified untouched. Refusal 1 is proven for a
committed job (`import.test.ts:387-389`) and for a cancelled one
(`import.test.ts:465-478`).

Refusal 4 has a **side effect you must handle**: before throwing, it *mutates the job* —
flagging each offending row `needs_attention` with `errors.category = "Unknown category"`,
recomputing `counts`, and saving (`service.ts:529-536`). So a 422 from commit can change what
`GET /:id` returns. Proven `import.test.ts:670-683`: after the 422, `counts` becomes
`{ready:1, needsAttention:1, conflict:0, skipped:0}` and row 0 carries
`errors === { category: "Unknown category" }`. **Always re-fetch the job after an
`IMPORT_NOT_READY`.**

Editing that row to an existing category clears the flag and returns it to `ready`
(`service.ts:49-53`, called from `resolveRowCategories`; proven `import.test.ts:685-692`).

Note refusal 2 does **not** look at `counts.conflict` — a job full of resolved conflicts
commits fine.

### Auto-create categories

At review time an unknown category name is **not** an error: the row stays valid, loses any
stale `categoryId`, and gains a note
`Category "Fizzy Drinks" does not exist yet — it will be created on commit`
(`service.ts:47`, `service.ts:84-87`; proven `import.test.ts:622-626`, where such rows are
`ready` and `counts.ready === 2`).

At commit, names are **re-resolved from scratch** rather than trusted from review time, because
a category may have been created or renamed in between (`service.ts:512-522`). Names still
unknown are created **inside the same transaction**, one per distinct *normalised* name
(`findOrCreateCategoriesByNames`, `src/services/category.service.ts:197-219`), where
normalisation is `name.trim().toLowerCase()`
(`src/lib/default-categories.ts:25`). **The first spelling seen wins as the display name**
(`category.service.ts:204-210`) — `"Fizzy Drinks"` and `"fizzy drinks"` in the same file
produce **one** category named `"Fizzy Drinks"`, holding both products (proven
`import.test.ts:608-644`).

A blank category cell means the product lands in the organization's **General** category via
`resolveProductCategoryId` (`category.service.ts:138-146`; proven `import.test.ts:579-581`,
`603`).

Category **matching** at review is case-insensitive against existing categories
(`findCategoriesByNames`, `category.service.ts:180-189`) — the file saying `drinks` resolves to
an existing `Drinks` (proven `import.test.ts:572-577`).

### Is it transactional? Yes — one transaction for the whole commit

`mongoose.startSession()` + `dbSession.withTransaction(async () => {...})`
(`service.ts:546-621`). Inside it, in this order:

1. Missing categories created once each (`service.ts:556-559`).
2. Each committing row's `parsed.categoryId` set from the resolved map, or deleted when the
   name is blank so the product falls back to General (`service.ts:560-569`).
3. **Every `ready` row** -> `createProductForOrg(organizationId, actorMemberId, parsed,
   dbSession)` (`service.ts:571-577`). That path writes an initial `adjustment` stock movement
   when `quantity > 0` (`src/services/product.service.ts:114-127`) — proven
   `import.test.ts:347-353` (one movement, type `adjustment`, quantity 20).
4. **Every `conflict` row resolved `"update"`** (`service.ts:579-618`):
   - fields are taken **only where the RAW cell was non-blank** — a blank cell never blanks a
     live product (`presentFieldsForUpdate`, `service.ts:451-472`, rationale `447-450`).
     `quantity` is deliberately excluded from that field set (`service.ts:458`), and `category`
     contributes the **resolved id**, never the name (`service.ts:463-467`);
   - the quantity difference becomes **one stock movement**: `restock` when higher,
     `adjustment` with reason `"Import: quantity adjustment"` when lower, nothing when equal
     (`service.ts:589-614`). Proven `import.test.ts:359-373`: existing quantity 50, file 55 ->
     one `restock` of 5, final quantity 55, and the untouched category preserved
     (`import.test.ts:365`).
5. `skip` and `skipped` rows are never touched.

Everything is all-or-nothing. Proven by the race test: after the abort, **zero** products from
the import exist and **zero** stock movements were written (`import.test.ts:451-454`).

### The race case

If a duplicate-barcode error surfaces mid-transaction — either a raw 11000 on `barcode` or a
`ConflictError` with code `DUPLICATE_BARCODE` from the product service
(`src/services/product.service.ts:162,179`) — the whole transaction rolls back and the service
(`service.ts:622-653`):

- re-loads the job, flips the offending row back to `conflict` against the **now-current**
  product, clears its errors, recomputes counts, saves;
- throws **409 `IMPORT_CONFLICT_CHANGED`**, message
  `"A product with this barcode was created by someone else while this import was being
  reviewed"`, with **`details: { rowIndex }`** (`service.ts:645-649`).

The job stays `reviewing` (proven `import.test.ts:456-460`, which also asserts
`details.rowIndex === 0` and that the row's `conflict.existingProductId` now points at the
racing product).

Any other error propagates untranslated (`service.ts:652`) — e.g. `STOCK_NOT_TRACKED` (409,
`product.service.ts:410`) if an `"update"` row carries a quantity for a product whose stock is
not tracked. That path is readable from source but **is not covered by any test I found**;
treat it as unverified.

### Response — `200`

```jsonc
{
  "success": true,
  "message": "Import committed",
  "data": {
    "result": { "created": 4, "updated": 1, "skipped": 1 },
    "productIds": ["...", "..."]
  }
}
```
(`controller.ts:177-180`)

- `created` = number of `ready` rows turned into new products.
- `updated` = number of `conflict` rows resolved `"update"`.
- `skipped` = rows with status `skipped` **plus** conflict rows resolved `"skip"`
  (`service.ts:504-506`).
- `productIds` = created ids first, then updated ids, as strings
  (`service.ts:550,575,616`; `controller.ts:179`). Length is `created + updated`, **not**
  `totalRows` — proven `import.test.ts:342-343` (`{created:4, updated:1, skipped:1}` on a
  6-row file, `productIds` length 5).

The commit response deliberately does **not** include the job. After a commit, `GET /:id`
returns `status: "committed"` with `result` populated (`import.test.ts:375-377`).

---

## 9. `DELETE /products/import/:id` — cancel

Route `product-import.route.ts:135-142`. Service `cancelImport` (`service.ts:441-445`):
requires `reviewing`, sets `status = "cancelled"`, saves.

Response: **`204` with an empty body** — `noContentResponse(res)` is
`res.status(204).end()` (`controller.ts:188`; `src/util/responses.ts:50`). There is no JSON
envelope on this one; do not `await res.json()`.

**It is a soft cancel, not a delete.** The document survives and continues to appear in
`GET /products/import` with `status: "cancelled"` until it expires. Nothing in
`src/db/actions/import-job.actions.ts` or `src/services/product-import.service.ts` calls
`deleteOne`, `deleteMany` or `findByIdAndDelete` — verified by grep across both files.

Cancelling a non-`reviewing` job is 409 `IMPORT_NOT_REVIEWING` (`service.ts:442` ->
`requireReviewingJob`, `service.ts:279-281`).

---

## 10. Lifecycle and expiry

`expiresAt` is set **once, at creation**, to `now + 7 days`:

```ts
const IMPORT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
// ...
expiresAt: new Date(Date.now() + IMPORT_EXPIRY_MS),
```
(`service.ts:28`, `service.ts:241`; proven within 60 s tolerance at `import.test.ts:123-125`)

The TTL index:

```ts
importJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```
(`model.ts:179`)

Three things follow that a frontend will get wrong by guessing:

1. **The clock is never advanced.** A job the user keeps reviewing for six days still dies on
   the original schedule — the model comment says exactly this (`model.ts:175-178`).
2. **There is no `partialFilterExpression`.** The index applies to *every* job regardless of
   status, so a **`committed` job's receipt disappears 7 days after the upload** — its
   `result` and `committedProductIds` go with it. The products remain, of course; the audit
   trail of which import made them does not. Do not build a permanent "import history" screen
   on this collection.
3. **MongoDB's TTL monitor runs on its own schedule** (roughly every 60 s), so a job can be
   readable for up to a minute past `expiresAt`. Do not treat `expiresAt < now` as a hard
   guarantee of 404; treat it as "expect a 404 at any moment".

Nothing else deletes a job: cancel sets a status (§9), commit sets a status
(`service.ts:656`), and there is no cron, no cleanup job and no admin purge anywhere in `src/`
that references `ImportJob` — verified by grep over `src/` for `ImportJob|import-job`, which
returns only the model, the actions, the service, the controller, the route and the validator.

The other listing index is `{ organizationId: 1, createdAt: -1 }` (`model.ts:174`), matching
the newest-first list sort.

---

## 11. Error codes for this scope

Envelope on failure (`src/util/responses.ts:63-79`, dispatched by
`src/middleware/error.middleware.ts:69-133`):

```jsonc
{ "success": false, "message": "...", "errors": {...}?, "code": "...", "details": {...}? }
```

`errors` appears only for `ValidationError`-derived failures (`error.middleware.ts:80-89`);
`code` and `details` appear for any `AppError` (`error.middleware.ts:95-98`).

| `code` | HTTP | Trigger | Source |
|---|---|---|---|
| `IMPORT_FILE_TOO_LARGE` | **413** | upload > 5 MB | `import-upload.middleware.ts:23-29` |
| `IMPORT_UNSUPPORTED_FORMAT` | 422 | zip-shaped file `exceljs` cannot open, or a workbook with no first sheet | `parse.ts:29-35,129-134` |
| `IMPORT_NO_ROWS` | 422 | 0 headers or 0 data rows | `parse.ts:37-43,59` |
| `IMPORT_TOO_MANY_ROWS` | 422 | > 2,000 data rows | `parse.ts:45-51,60` |
| `IMPORT_UNKNOWN_HEADER` | 422 | `PATCH /columns` names a header not in the file, **or** the merged map points two fields at one header | `service.ts:321-341` |
| `IMPORT_ROW_NOT_FOUND` | **404** | `:index` matches no row on this job | `service.ts:287` |
| `IMPORT_ROW_NOT_CONFLICT` | 422 | `/resolve` on a row whose status is not `conflict` | `service.ts:426-431` |
| `IMPORT_NOT_REVIEWING` | **409** | any mutating call on a `committed` or `cancelled` job | `service.ts:279-281` |
| `IMPORT_NOT_READY` | 422 | commit with `needsAttention > 0`, an unresolved conflict, or unknown categories the caller may not create | `service.ts:494-501`, `537-542` |
| `IMPORT_CONFLICT_CHANGED` | **409** | duplicate-barcode race during the commit transaction; `details.rowIndex` | `service.ts:645-649` |
| `VALIDATION_ERROR` | 422 | any zod failure from `validate`; **also** `PATCH /columns` with a key that is not a product field; **also** a missing `file` part; **also** a malformed multipart request | `validate.middleware.ts:80`, `service.ts:300`, `controller.ts:71`, `import-upload.middleware.ts:31` |
| `NOT_FOUND` | 404 | job id not found **in this organization** | `service.ts:262`, `errors.ts:77-88` |
| `FORBIDDEN` | 403 | missing `products:create` on any route; missing `products:update` at commit with an `"update"` row | `auth.middleware.ts:168`, `service.ts:509` |
| `UNAUTHORIZED` | 401 | no/expired session (only reachable *after* `validate` on nine of the ten routes) | `auth.middleware.ts:41-44` |
| `TOO_MANY_REQUESTS` | 429 | 21st upload in 15 min per organization; `Retry-After` header | `rate-limit.middleware.ts:166-167` |
| `DUPLICATE_BARCODE` | 409 | a barcode race the import handler did **not** classify (e.g. `raceRowIndex` unset) falls through to the product service's own code | `product.service.ts:162,179`; reachable via `service.ts:652` |
| `CATEGORY_NOT_FOUND` | 422 | a resolved `categoryId` no longer resolves inside the transaction | `category.service.ts:149-154` — reachable in theory, **not exercised by any test** |
| `STOCK_NOT_TRACKED` | 409 | an `"update"` row supplies a quantity for a product whose stock is not tracked | `product.service.ts:410` — reachable via commit, **not exercised by any test** |

The last three are marked as such deliberately: they are readable from source but I did not
find a test that drives them, so their exact behaviour through the import path is **unverified**.

### Reproducing the two executed checks

Run from `Backend/`:

```bash
bun -e '
const v = await import("./src/validators/product-import.validation.ts");
const c = await import("./src/services/import/clean.ts");
console.log(JSON.stringify(v.importRowPatchSchema.safeParse({ sellingPrice: 12 })));
console.log(JSON.stringify(v.importRowPatchSchema.safeParse({})));
console.log(JSON.stringify(c.validateRow({ name:"x", costPrice:1, sellingPrice:2, unit:"pcs", trackStock:true })));
'
```

Actual output on zod 4.4.3 (`Backend/package.json:40`):

```
{"success":true,"data":{"unit":"pcs","sellingPrice":12,"trackStock":true,"quantity":0}}
{"success":true,"data":{"unit":"pcs","trackStock":true,"quantity":0}}
{"ok":true,"value":{"name":"x","unit":"pcs","costPrice":1,"sellingPrice":2,"trackStock":true,"quantity":0}}
```

---

## 12. What the tests prove that the source does not make obvious

`tests/integration/products/import.test.ts` (17 `test(...)` blocks; the BRD at
`Backend/docs/requirements/p3-product-import/BRD.md:165` says 11 — it is out of date) and the
three unit files.

1. **`counts` on a realistic file.** A 6-row QuickBooks CSV with one missing price, one
   duplicate barcode pair and one existing-barcode collision yields exactly
   `{ready:2, needsAttention:3, conflict:1, skipped:0}` (`import.test.ts:104`) — note the
   duplicate **pair contributes 2** to `needsAttention`, not 1, and the conflict row is *not*
   counted in `needsAttention`.
2. **Fixing one duplicate frees the other without a second call** (`import.test.ts:281-291`).
   The reconciliation is file-wide on every mutation, so after any row PATCH you should
   re-fetch the job, not just patch your local copy of the one row you edited.
3. **A remap wipes manual row edits**, and the test has to redo them
   (`import.test.ts:328-335`). The source says the rows are "re-derived" — the test makes the
   destructiveness concrete.
4. **A resolved conflict keeps `status: "conflict"`** (`import.test.ts:305-307`). This is the
   single easiest thing to get wrong in a "can I commit?" check.
5. **Commit's 403 for a missing `products:update` happens before any write**, verified by
   asserting the existing product is byte-identical afterwards (`import.test.ts:420-424`).
6. **The race abort is genuinely atomic**: zero products, zero stock movements
   (`import.test.ts:451-454`), job still `reviewing` (`457`), and the row now points at the
   *racing* product (`460`).
7. **An unknown category is `ready`, not `needs_attention`, at review** — `counts.ready` is 2
   for a file whose only category does not exist (`import.test.ts:626`). The source's `notes`
   mechanism is easy to read as an error; the test shows it is not one.
8. **`IMPORT_NOT_READY` from the categories path mutates the job**, and the test asserts the
   post-refusal `counts` and `errors` (`import.test.ts:674-680`). This is the only refusal in
   the whole surface with a write side effect.
9. **Two spellings of the same category name create exactly one category**, keeping the first
   spelling, with `productCount: 2` (`import.test.ts:635-641`).
10. **A blank category cell leaves an updated product's existing category untouched**
    (`import.test.ts:365`) — the "blank never blanks" rule, proven for the category
    specifically.
11. **Cross-org access is 404 and Seller access is 403 on the same endpoint**
    (`import.test.ts:221-230`) — do not collapse them into one error state.
12. **The rate limit is reached at the 21st request**, i.e. `max: 20` means 20 succeed
    (`import.test.ts:145-155`).
13. **`limit=201` is a 422, `limit=200` is not** (`import.test.ts:218-219`) — the row cap really
    is 200 and not the 100 every other list endpoint uses.
14. **`csv` numeric-style detection is a majority vote and ties default to `dot`**
    (`tests/unit/import-clean.test.ts:100-111`), and `"KSh 1 200,50"` under comma style parses
    to `1200.5` (`import-clean.test.ts:16-19`).
15. **The template's header line is asserted verbatim** (`import.test.ts:186`), so it is safe to
    hard-code that string in a "your file should look like this" hint.

---

## 13. Traps

**Trap 1 — `PATCH /rows/:index` silently overwrites `unit`, `trackStock` and `quantity` on
every call.** *(verified by execution, §11)* `importRowPatchSchema` is
`importRowSchema...partial()` (`validation.ts:43-47`), but `importRowSchema` inherits
`createProductSchema`'s `.default()`s for `unit` (`"pcs"`), `trackStock` (`true`) and
`quantity` (`0`) (`product.validation.ts:60-65`). Under zod 4, **`.partial()` does not suppress
a `.default()` on a genuinely missing key** — the exact defect documented at
`product.validation.ts:22-40`, which was fixed for `updateProductSchema` and **not** for this
schema. So `PATCH { sellingPrice: 12 }` arrives at the service as
`{ sellingPrice: 12, unit: "pcs", trackStock: true, quantity: 0 }`, and
`merged = { ...row.parsed, ...patch }` (`service.ts:381`) lets those three clobber whatever the
file said. A row for a product sold by `kg` becomes `pcs`; a service item with
`trackStock: false` (set by the service-name heuristic, `clean.ts:172-175`) flips to `true`;
a quantity of 100 becomes 0.

**Mitigation: always send the row's *current* `parsed.unit`, `parsed.trackStock` and
`parsed.quantity` alongside whatever you are actually changing.** Read them from the row you
already have. This is not optional.

**Trap 2 — `PATCH /rows/:index` with an empty body returns 200, not 422.** *(verified by
execution)* The `.refine(b => Object.keys(b).length > 0, "Nothing to update")`
(`validation.ts:47`) runs **after** the defaults are injected, so `{}` parses to a
three-key object and the refine is vacuously true. The row is then "edited" with those three
defaults — i.e. an accidental empty PATCH is a *destructive* no-op, per Trap 1. Guard against
sending one client-side.

**Trap 3 — there are ten endpoints, and two of them do not speak JSON.**
`GET /template` returns raw `text/csv` (`controller.ts:215-217`) and `DELETE /:id` returns
`204` with a completely empty body (`controller.ts:188`, `responses.ts:50`). A shared API
client that unconditionally parses `res.json()` will throw on both.

**Trap 4 — pagination metadata lives in two different places.** `GET /products/import` puts it
in the envelope's `meta` (`paginatedResponse`, `responses.ts:52-61`). `POST /` and
`GET /:id` put it in **`data.rowsMeta`** (`controller.ts:88`, `115-120`) and have **no**
envelope `meta` at all. And `PATCH /columns`, `PATCH /rows/:index`, `DELETE /rows/:index`,
`POST /resolve` return neither, because they return a bare summary or a bare row.

**Trap 5 — `counts.conflict === 0` is the wrong "ready to commit" test.** A resolved conflict
row keeps `status: "conflict"` (`service.ts:434` only writes `conflict.resolution`; asserted
`import.test.ts:305-307`), so `counts.conflict` never drops when the user resolves things. The
condition the server actually uses is
`counts.needsAttention > 0 || conflictRows.some(r => !r.conflict?.resolution)`
(`service.ts:492-494`). Reproduce **that**, which means you need per-row `conflict.resolution`
— and the summary alone does not carry it. You must have fetched the rows.

**Trap 6 — the "Duplicated in the file (rows 3, 4)" message uses 0-based `index` values, not
spreadsheet row numbers.** `indices.join(", ")` over `row.index`
(`service.ts:152-154`). In a file with a header row, `index` 3 is the spreadsheet's row 5.
The design spec's illustrative wording is `"rows 12 and 40"`
(`Backend/docs/superpowers/specs/2026-09-05-product-import-design.md:120`) but the shipped
string uses `", "` and 0-based numbers — the source wins. If you show this message verbatim the user will look at the wrong rows. Either
rewrite it client-side from `index + 2`, or display `index` consistently everywhere and label
it "row (0-based)".

**Trap 7 — `POST /` gives you only the first 20 rows, and there is no way to ask for more from
that call.** `limit` and `page` are literals in the controller
(`controller.ts:80,88`). A 2,000-row import needs a follow-up `GET /:id?limit=200&page=N`
loop — up to 10 calls. Budget for it in the reviewer UI rather than assuming the create
response is complete.

**Trap 8 — `PATCH /columns` has two different codes for two things that look identical.**
An unknown *product field* key (`{ colour: "Colour" }`) is
`VALIDATION_ERROR` with `errors.columnMap = 'Unknown product field "colour"'`
(`service.ts:298-301`, default code). An unknown *file header* (`{ sellingPrice: "Nope" }`) is
`IMPORT_UNKNOWN_HEADER` with `errors.sellingPrice` (`service.ts:321-328`). Branching only on
`IMPORT_UNKNOWN_HEADER` will drop the first case into your generic error handler. Also note the
second case keys `errors` by the **product field name**, while the two-fields-one-header case
keys it by the literal `"columnMap"` (`service.ts:335-336`) — three different `errors` shapes
from one endpoint.

**Trap 9 — a skipped row cannot be un-skipped by a dedicated endpoint.** There is no
`POST /rows/:index/restore`. `skipRow` only ever sets `skipped` (`service.ts:404`). A `PATCH`
*will* revive it — `editRow` re-validates and assigns `ready`/`needs_attention`
unconditionally (`service.ts:383-385`) — but that requires sending at least one field, and per
Trap 1 you must send `unit`/`trackStock`/`quantity` explicitly to avoid corrupting it. Design
the "undo skip" button as a PATCH echoing the row's own `parsed`, and test it.

**Trap 10 — `validate` runs before `requireAuth` on nine of ten routes, so 422 outranks 401.**
`product-import.route.ts:65,74,83,92,101,110,119,128,137` all put `validate` first; only
`POST /` (`route.ts:48-57`) does not. A logged-out request with a bad id gets 422. Never treat
a 422 as proof the session is alive. (Same defect class already recorded in `sales.md` and
`debts.md`.)

**Trap 11 — no MIME allow-list exists, and unknown files are treated as CSV.** See §1. Two
concrete failures: a `.xls` gets `IMPORT_NO_ROWS` (a confusing message for a real spreadsheet),
and a `.pdf` gets the same. If you want "that file type isn't supported", you must produce it
client-side; the server never says it for those inputs.

**Trap 12 — `expiresAt` is absolute and applies to committed jobs too.** A committed job's
`result`/`committedProductIds` vanish 7 days after **upload**, not after commit
(`service.ts:241`, `model.ts:179`, comment `model.ts:175-178`). Do not build a permanent import
history from this collection, and do not show "expires in N days" as if editing extended it.

**Trap 13 — the row `limit` cap is 200 here and 100 everywhere else.** `validation.ts:15` vs
`common.validation.ts:29`. A shared `PAGE_SIZE_MAX = 100` constant in the frontend will
under-fetch by half on the one endpoint where the extra headroom matters most.

**Trap 14 — `needsAttention` (camelCase, in `counts`) vs `needs_attention` (snake_case, the
row status and the `?status=` query value).** `model.ts:64-69` vs `model.ts:10` and
`validation.ts:13`. They are not interchangeable, and a naive `counts[row.status]` lookup
returns `undefined`.

**Trap 15 — the wire id is `id`, and `conflict.existingProductId` is a string.**
`controller.ts:53` uses the Mongoose virtual; `controller.ts:45` and `controller.ts:62`
`.toString()` their ObjectIds. There is no `_id` anywhere in these responses. Conversely
`parsed.categoryId` is *also* a plain string (`model.ts:24-26`) — it is the resolved category
id, not an object; there is no category **name** on it, so a "Category" column in the reviewer
must read `parsed.category` (the file's text) or join against `GET /categories` yourself.

**Trap 16 — `conflict`, `committedAt`, `committedProductIds` and `result` are *absent* keys, not
`null`.** `publicRow` returns `undefined` for `conflict` when there is none
(`controller.ts:49`), and `publicJobSummary` uses `?.map` for `committedProductIds`
(`controller.ts:62`); `res.json` drops `undefined` values. Type them optional, and do not write
`row.conflict === null` checks.

**Trap 17 — after any successful mutation you are holding a stale `counts`.** Every mutating
service function recomputes `job.counts` (`service.ts:366,389,409,534`), but only
`PATCH /columns` returns the job (`controller.ts:130`); the three row endpoints return the row
alone (`controller.ts:139,148,158`). If your header shows "3 need attention", re-fetch
`GET /:id` after every row action — the whole-file reconciliation may have changed rows you
did not touch (Trap/Test 2).

---

## 14. Unverified

- `CATEGORY_NOT_FOUND` (422) and `STOCK_NOT_TRACKED` (409) escaping the commit transaction are
  readable from `category.service.ts:149-154` and `product.service.ts:410` respectively, and
  `service.ts:652` re-throws anything it does not classify — but **no test drives either through
  the import path**. Handle them generically; do not write copy that claims to know when they
  fire.
- Mongoose's behaviour when `row.conflict = undefined` is assigned on a subdocument inside a
  `markModified("rows")` array (`service.ts:155,362,386,406,532`) is *assumed* to actually clear
  the stored field. Tests assert the presence of a conflict after a flip
  (`import.test.ts:458-460`) and the persistence of a resolution (`305-307`), but **no test
  asserts that a cleared conflict is gone from a later `GET`**. Treat `conflict` as possibly
  stale on a row whose status is not `conflict`, and key your UI off `status`.
- The exact zod message strings inside `errors` (e.g.
  `"Invalid input: expected number, received undefined"` for a missing price) are zod-generated
  and will change with a zod upgrade. Do not string-match them; they are for display only.
- XLSX uploads are covered only at the **unit** level (`tests/unit/import-parse.test.ts:38-64`
  calls `parseImportFile` directly). No integration test posts an `.xlsx` through the HTTP
  endpoint — `tests/helpers/import-files.ts:9-21` provides an `xlsx()` builder but
  `import.test.ts:11` imports only `csv`. The multipart path for xlsx is therefore
  **untested end-to-end**; expect to find the first real bug there.
- `GET /products/import/template` is not tested for the anonymous or wrong-query cases, so the
  claim that `?anything=1` returns 422 is read from `noBodySchema`'s `.strict()`
  (`common.validation.ts:21`) plus the route wiring (`route.ts:65`), not observed.
