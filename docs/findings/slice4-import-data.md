# Slice 4 — the product import data layer

`features/product-import/` — types, keys, schemas, service and hooks for the ten
`/products/import` endpoints. No components; the wizard UI is a separate task.

Verified 2026-09-10: `bunx tsc --noEmit` clean, `bunx biome check` clean over the new files,
`bunx vitest run features/product-import` 31 tests green, full suite 61 files / 542 tests green.
One pre-existing biome formatting error in `app/(app)/customers/page.tsx` (a stray `console.log`)
belongs to whoever is working there — it is not mine and I left it alone.

Written against `docs/contracts/product-import.md`, which was the authority throughout, and
alongside `docs/findings/slice4-import-live-observations.md`, which is the same endpoints seen
from outside with real data.

---

## 1. Two of the contract's traps are now stale, and following them would re-create the bug

**Trap 1** ("`PATCH /rows/:index` silently overwrites `unit`, `trackStock` and `quantity` on every
call — always echo the row's current values, this is not optional") and **Trap 2** ("an empty
`PATCH` body returns 200, not 422") were both true when the contract was written and are both
**false now**. `Backend` commit `48c7205` (*fix(import): stop zod defaults leaking into a partial
row patch*, 2026-09-10) re-declares the three defaulted fields without their defaults:

```ts
export const importRowPatchSchema = importRowSchema
  .omit({ categoryId: true })
  .partial()
  .extend({
    unit: productFields.unit.optional(),
    trackStock: productFields.trackStock.optional(),
    quantity: z.number().refine((n) => n === 0 || isQuantity(n)).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });
```

`Backend/src/validators/product-import.validation.ts:64-76`.

Re-running the contract's own §11 reproduction against the current tree:

```
patch{sellingPrice:12}  {"success":true,"data":{"sellingPrice":12}}
patch{}                 {"success":false, … "message":"Nothing to update"}
patch{unit:"kg"}        {"success":true,"data":{"unit":"kg"}}
patch{categoryId:…}     {"success":false, … "Unrecognized key: \"categoryId\""}
```

**So the mitigation is now the bug.** Echoing `unit`, `trackStock` and `quantity` defensively today
writes three fields the user did not touch — which is precisely the corruption the fix removed. The
schema and the `usePatchImportRow` doc both say send only what changed, and
`import.schema.test.ts` pins `safeParse({ sellingPrice: 12 })` to `toEqual({ sellingPrice: 12 })`
so a future mirror cannot silently re-grow the defaults.

Everything else in the contract that I exercised held. Trap 9's advice ("design the undo-skip button
as a PATCH echoing the row's own `parsed`") is now over-cautious rather than wrong: one real field
is enough.

### A detail neither the contract nor the fix mentions

The `"Nothing to update"` refine and the `unrecognized_keys` refusal are both **object-level** zod
issues with an empty `path`, and `zodToFieldErrors` keys an empty path as the literal **`"_"`**
(`Backend/src/middleware/error.middleware.ts:9-16`). So those 422s arrive as
`errors: { _: "Nothing to update" }`, not under a field name — a form that only maps `fieldErrors`
onto registered inputs will show nothing at all. `fieldErrorsFor` returns it; the form has to have
somewhere to put a `_`.

---

## 2. `lib/api/errors.ts` needed no change — all ten `IMPORT_*` codes were already there

The brief expected some to be missing. They are not: `IMPORT_UNSUPPORTED_FORMAT`,
`IMPORT_FILE_TOO_LARGE`, `IMPORT_TOO_MANY_ROWS`, `IMPORT_NO_ROWS`, `IMPORT_UNKNOWN_HEADER`,
`IMPORT_NOT_REVIEWING`, `IMPORT_ROW_NOT_FOUND`, `IMPORT_ROW_NOT_CONFLICT`,
`IMPORT_CONFLICT_CHANGED` and `IMPORT_NOT_READY` are all present under a `// Product import.`
heading. Nothing was added and nothing was removed.

---

## 3. How `canCommit` is modelled, and why the obvious test is wrong

The server's gate, read from source (`Backend/src/services/product-import.service.ts:489-501`):

```ts
const conflictRows = job.rows.filter((r) => r.status === "conflict");
const unresolvedConflict = conflictRows.some((r) => !r.conflict?.resolution);
if (job.counts.needsAttention > 0 || unresolvedConflict) throw IMPORT_NOT_READY;
```

`counts.conflict` is **not** in it, and it cannot be: resolving a conflict writes only
`conflict.resolution` and leaves `status: "conflict"`, so the tally never falls however many
decisions the reviewer makes. A button gated on `counts.conflict === 0` is disabled forever; a
banner gated on it accuses someone who has already done the work.

The structural consequence is the interesting part: **the job summary can prove a "no" but can
never prove a "yes".** `counts.needsAttention > 0` settles it from the summary alone. The conflict
half needs per-row `conflict.resolution`, which `publicJobSummary` does not carry at all.

`commitReadiness` in `features/product-import/schemas/import.schema.ts` therefore takes
`{ job: Pick<ImportJobSummary, "status" | "counts">, rows, canUpdateProducts? }` and returns
`{ canCommit, blocker, unresolvedConflictIndexes, updateRowIndexes, commitsNothing }`. It:

- **checks coverage before it answers.** If it holds fewer rows with `status === "conflict"` than
  `counts.conflict` claims exist, the blocker is `conflicts_not_loaded` with `{ loaded, expected }`
  — a state the UI renders as "checking", never as "fix your rows". `useImportJobConflicts(id)`
  fetches them at `?status=conflict&limit=200`, sharing `useImportJob`'s cache entry.
- **de-duplicates rows by `index`**, so a caller accumulating pages can pass them straight in.
- **matches on `status === "conflict"`, not on the presence of a `conflict` object.** Contract §14
  marks it unverified that clearing a conflict actually removes the stored field and says to key off
  `status`; a leftover must not be able to block a commit.
- **predicts the 403** as well as the 422. The commit reads `products:update` off the caller's role
  and refuses before the transaction opens if any row is resolved `"update"`. Pass
  `canUpdateProducts` from `useCan(PERMISSIONS.PRODUCTS_UPDATE)` and the wizard blocks at the step
  where the decision was made rather than at the end. Omitting it (a session still loading) predicts
  nothing rather than inventing a refusal.

### What it deliberately does not predict

The commit's **fourth** refusal — a committing row naming a category that does not exist while the
caller lacks `categories:create` — is also a 422 `IMPORT_NOT_READY`, and it is not predictable from
anything on the wire. The only client-side signal is the wording of a row `note`
(`Category "X" does not exist yet — it will be created on commit`), and branching on a message is
exactly what this codebase does not do. Joining `GET /categories` would work but needs every
committing row, not just the conflicts. So it is handled after the fact — and that path is the only
refusal in the whole surface with a **write side effect**, so `useCommitImport` invalidates the job
on `IMPORT_NOT_READY` and on `IMPORT_CONFLICT_CHANGED`, and on nothing else.
`countsFromNotReadyError` and `rowIndexFromConflictChangedError` read the `details` each carries.

### A commit that writes nothing is legal, and the server takes it

If every row is `skipped` (or resolved `"skip"`), `counts.needsAttention` is 0, there are no
unresolved conflicts, and the commit **succeeds** — `{ created: 0, updated: 0, skipped: N }` — and
the job is marked `committed`, irreversibly, since there is no way back out of that status. That is
not in the contract; it falls out of the gate above.

Reporting it as a blocker would disable a control the server would accept, which is its own kind of
lie, so it is the advisory `commitsNothing: boolean` instead. Put a confirmation in front of it, not
a disabled button.

---

## 4. `GET /template` cannot go through the shared API client at all

Not "should not" — cannot. `unwrap` runs on every response and throws `UNEXPECTED_RESPONSE` on a
body that is not an envelope, and `responseType: "blob"` does not rescue it because a `Blob` is not
an envelope either. `lib/api/client.ts` is the only axios instance allowed, so `downloadTemplate`
uses `fetch` with `credentials: "include"` (same-origin through the `next.config.ts` rewrite, so the
cookie rides along) and normalises failures into an `ApiError` by hand — reading `code`, `message`,
`errors`, `details` and `X-Request-Id` off the ordinary JSON envelope a *failure* still carries.

**The consequence to know: the central 401 redirect does not fire on this one request.** A dead
session surfaces as a thrown `ApiError` rather than a bounce to `/login`. Acceptable because
`app/(app)/layout.tsx` already gates the page server-side, but it is a real asymmetry and it is
worth remembering if a second raw-body endpoint ever appears.

`IMPORT_TEMPLATE_HEADERS` is exported so the "your file should look like this" hint can be rendered
without fetching anything; the backend asserts that header line verbatim in its own test.

---

## 5. A stale comment in `features/uploads/services/upload.service.ts`

`createUpload` passes `headers: { "Content-Type": null }` and carries a long comment explaining that
"the shared axios instance sets `headers: { "Content-Type": "application/json" }` as an instance
default". **It does not, any more** — `lib/api/client.ts` deliberately sets no `Content-Type`
default, and says so at length in its own comment, precisely so `FormData` works.

The `null` is harmless (it removes a header that is not there), but the rationale reads as though
the default still exists, and the next person to write a multipart call will copy it. `createJob`
here sets no header at all. Not changed — `features/uploads` is not mine — but it should be
reconciled, and the two comments currently contradict each other.

---

## 6. Invalidation: a row write can change rows nobody touched

This is the one property of these endpoints with no parallel elsewhere in the app. Every mutating
service function re-runs `reconcileRows` over the **whole file** and recomputes `counts`
(`product-import.service.ts:189-192, 366, 389, 409, 534`). Fixing one half of a duplicate-barcode
pair flips the other half to `ready` on a page nobody has open. And the responses cannot describe
it: only `PATCH /columns` returns the job, and it returns it *without rows*; the three row endpoints
return the single row they touched; the commit returns neither.

So: **invalidate the whole job, never patch a page.** `importKeys.jobPage(id, params)` nests under
`importKeys.detail(id)`, which makes one `invalidateQueries({ queryKey: importKeys.detail(id) })`
reach every page and every status filter at once. Nothing in `use-import-mutations.ts` calls
`setQueryData` on a row or a page.

`importKeys.lists()` goes with it on **all seven** writes, not just create and cancel:
`publicJobSummary` carries `counts` and `status`, so a job-list row goes stale on a row edit too.

The commit additionally invalidates `productKeys.all` (products created *and* updated, plus stock
movements for both — which ids moved is knowable from `productIds`, which *lists*, *barcode lookups*
and *movement pages* they appear on is not), `categoryKeys.lists` (categories are auto-created
inside the transaction; note `categoryKeys` is the raw `createQueryKeys` result, so `lists` is an
**array**, not a function) and `dashboardKeys.all`.

### Query-key stability, and why the defaults are resolved client-side

`{}`, `{ page: 1 }` and `{ status: "all", page: 1, limit: 20 }` all describe the same request and
would hash to three different keys. `resolveImportRowParams` fills in the server's own defaults and
is idempotent, so `keys.jobPage` and the request are built from the same call. That is what lets
`useUploadImport` seed the `POST` response — which is page 1 of 20 rows at `status: "all"`, the
literals hard-coded in the controller — into a key `useImportJob(id)` will actually read.

---

## 7. What the design assumes the API cannot deliver

Beyond the two already recorded in `slice4-import-live-observations.md` (raw zod `errors` messages
unfit to show a shopkeeper; `conflict` carries no price or quantity):

- **"Uploaded by" on the jobs list is impossible.** `createdBy` is stored on the model
  (`import-job.model.ts:79,151`) and `publicJobSummary` never maps it, so there is not even an id to
  join a member name against.
- **A permanent import history does not exist.** The TTL index has no `partialFilterExpression`, so
  it applies to `committed` jobs too and `expiresAt` is `createdAt + 7 days`, absolute — a receipt's
  `result` and `committedProductIds` vanish a week after the **upload**, not after the commit. The
  products remain; the record of which import made them does not.
- **The jobs list has no server-side filter.** `?status=` on `GET /products/import` is a 422, not an
  ignored key. A "cancelled only" tab filters the fetched page and must not claim to filter the
  list, because `meta.total` still counts every job.
- **There is no un-skip endpoint.** The undo is a `PATCH` (see §1).
- **There is no progress or polling state.** Parsing is synchronous inside the upload request, so
  the job either exists as `reviewing` or the `POST` itself failed. There is no `parsing`/`failed`
  status to render.
- **`POST /` gives 20 rows and there is no way to ask for more.** `page` and `limit` are literals in
  the controller. A 2,000-row review is up to ten follow-up `GET /:id?limit=200&page=N` calls.
- **Row numbers in the server's own duplicate message are 0-based data indexes.** "Duplicated in the
  file (rows 3, 4)" means spreadsheet rows 5 and 6. `spreadsheetRowNumber(index)` (`index + 2`) is
  exported for every number the UI produces itself; the server's string cannot be rewritten without
  matching on it, so a screen showing it verbatim needs to say elsewhere which numbering it uses.

---

## 8. Decisions I made, and the questions I had to answer myself

| Decision | Why |
|---|---|
| `commitReadiness` and the three small readers live in `schemas/import.schema.ts` | The brief fixes the file list, and that is the only one with a `.test.ts` companion. Precedent: `features/debts/schemas/debt.schema.ts` already holds `dueDateFromCalendarDate` and `remainingFromPaymentError`, neither of which is a schema. |
| `conflicts_not_loaded` is a blocker, not a `canCommit: true` | A "yes" the client cannot prove is a button that 422s. Refusing to guess costs a fetch; guessing costs the user a failed commit at the end of a wizard. |
| `commitsNothing` is advisory, not a blocker | The server accepts it (§3). Disabling a control the server would accept is a lie in the other direction. |
| `columnMapPatchSchema` names all ten keys instead of mirroring the backend's loose `z.record(z.string(), …)` | The real gate is one layer in, and an unknown *product field* is a plain `VALIDATION_ERROR`, not `IMPORT_UNKNOWN_HEADER` (Trap 8) — so a caller branching on the import code drops it into the generic handler. Naming the keys makes it a compile error instead. `satisfies Record<ProductImportField, unknown>` keeps it from drifting. |
| Column-map header values are `.trim()`ed, which the backend does not do | The headers they are matched against were themselves trimmed at parse time, so an untrimmed value could only ever produce a spurious `IMPORT_UNKNOWN_HEADER`. |
| `useUploadImport` seeds the detail cache; row mutations seed nothing | The `POST` response *is* the default `GET /:id` page, byte for byte. A row response is not a page and cannot stand in for one (§6). |
| Upload timeout raised to 120 s; commit left at the client's 30 s | The upload's size is chosen by the user (5 MB on a phone connection), and a timeout throws away work that was succeeding — plus the retry spends organization-wide rate-limit budget. `lib/api/client.ts` states in its own comment that its 30 s was chosen *for* the import commit, so that one is left alone. |
| `useImportJobConflicts` fetches at `limit: 200` | The cap here is 200, not the usual 100 (`MAX_IMPORT_ROW_LIMIT` exists for this). One page covers any realistic job; beyond that `commitReadiness` keeps saying `conflicts_not_loaded`, which is the correct answer. |
| `IMPORT_ACCEPT_ATTRIBUTE` is exported but documented as **our** UX choice | There is no `fileFilter` on the multer instance at all — no MIME allow-list, no extension check. CSV is the *fall-through*, so a `.xls`, a `.pdf` and a `.txt` all come back as `IMPORT_NO_ROWS`. "We could not read this file" is the right sentence there; "this file has no rows in it" is not. |
| `useCommitImport` invalidates on exactly two error codes | `IMPORT_NOT_READY` and `IMPORT_CONFLICT_CHANGED` write to the job before throwing; 409 `IMPORT_NOT_REVIEWING` and the 403 provably touch nothing. Branching on `code` is what keeps them apart. |

Nothing was guessed about a wire shape. The one thing I could not verify and did not try to is the
**xlsx multipart path end to end** — contract §14 records that no integration test posts an `.xlsx`
through HTTP (the helper exists, the test file imports only `csv`), so the `.xlsx` branch of this
data layer is written from source and unit tests alone. If a real bug turns up in this slice, that
is where I would look first.

---

## 9. Files

```
features/product-import/
  types.ts
  keys.ts
  schemas/import.schema.ts
  schemas/import.schema.test.ts
  services/import.service.ts
  hooks/use-import-jobs.ts
  hooks/use-import-job.ts          — useImportJob, useImportJobConflicts
  hooks/use-import-mutations.ts    — upload, remap, patch row, skip row,
                                     resolve conflict, commit, cancel
```

`lib/api/errors.ts` untouched (§2). No `.tsx` and no route added.
