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

---

# 2026-09-10 (later) — the wizard shell, step 1 (Upload) and step 2 (Map columns)

Artboard `2e`, the first half: `app/(app)/products/import/page.tsx`, the wizard shell, the drop
zone, the Previous jobs panel and the column mapper. Steps 3 and 4 (`review-step.tsx`,
`commit-bar.tsx` and the three files under them) were built in parallel by another agent against a
fixed interface — `<ReviewStep jobId job />` and `<CommitBar jobId job />` — and are theirs.

Verified 2026-09-10: `bunx tsc --noEmit` clean, `bunx biome check` clean over these eleven files,
`bunx vitest run features/product-import` 106 green, full suite 70 files / 638 tests green. The
biome errors I left alone are the owner's stray `console.log` in `app/(app)/customers/page.tsx` and
four formatting errors in the other agent's specs.

## 10. The `columnMap` inversion, and the trap that comes with it

The API answers `field -> header`; artboard `2e` draws one row per **file header** with a dropdown
choosing the field it feeds. Both directions are exported pure functions in `column-map-step.tsx`,
which is what let them be tested without a render:

- `invertColumnMap(job)` gives `Map<header, field>`, skipping the nulls. The inverse is **total**:
  the server refuses a merged map in which two fields claim one header, so no header is ever the
  value of two keys and the `Map` cannot silently lose an entry.
- `fileHeaders(job)` takes the file's own column **order** from `Object.keys(job.rows[0].raw)`.
  That is the same place the server derives the file's real header set from
  (`product-import.service.ts:317`), and it is the only ordered source — `columnMap` is keyed by
  our ten fields in our order, and `unmatchedHeaders` is a leftovers list. There is a fallback for
  a row page that came back empty under a status filter; it cannot preserve order, which is why it
  is a fallback and not the primary path.
- `patchForHeader(header, from, to)` builds the `PATCH` body. **Both halves always go in one
  call** — `{ costPrice: null, sellingPrice: "Cost" }` — because the *merged* map is what the
  server validates and `{ sellingPrice: "Cost" }` alone is refused while `costPrice` still holds
  that header. It returns `null` when nothing would change, which is what keeps an idle `change`
  event off the most destructive endpoint in the slice.

**A consequence worth stating: this screen's own arithmetic can never produce either
`IMPORT_UNKNOWN_HEADER` case.** The headers come from the file, and every patch clears the old
field in the same call, so neither "not a column in this file" nor "cannot be mapped to both" is
reachable unless the job moved underneath the page — another tab, or a stale render. Both are
still handled and both say exactly that, but a future reader should not mistake the branch for
dead code, nor assume it means the client miscomputed something.

### A file header is not a DOM id

`aria-describedby` is a **space-separated list of ids**, and a real spreadsheet heading is
"Sales Price". Building ids out of the header produced ids containing spaces, which made the
select's `aria-describedby` point at two ids that do not exist while `htmlFor` went on working —
an accessibility break that renders perfectly and passes a smoke test. Ids are now `useId()` plus
the column's index. Anything keyed by user data has the same problem.

## 11. What the design asks for that the API cannot deliver

| Artboard `2e` shows | The API | What shipped |
|---|---|---|
| a bare dashed drop zone | — | A real `<input type="file">` had to be added: the artboard draws no picker affordance at all, and a `div` with an `onClick` is unreachable by keyboard and invisible to assistive tech. It is `sr-only` — visually hidden, still focusable, still announced — with the upper block of the zone as its `<label>`, so its accessible name is the design's own words plus the size rule. "Download template" sits **outside** the label, because a button nested inside one is a click target fighting the label's own activation. |
| "expires in 6 d" | `expiresAt`, absolute | Days round **up**. A job uploaded a day ago has 5 d 23 h left; floored that reads "5 d", which is an hour-accurate lie about which day it dies — and rounding up is how the artboard's own row gets to 6. Below 24 h the unit changes to hours, because "expires in 1 d" over thirty remaining minutes is the one rounding error that costs someone their work. No timezone is involved and none should be: it is an elapsed duration between two instants, and a calendar-day difference would move it across midnight for a reader in another zone. |
| a date on a committed job | `committedAt`, plus the same absolute `expiresAt` | The date is drawn as designed, but the panel needed a footnote the artboard has no room for: the TTL index has no `partialFilterExpression`, so a **committed** job's `result` and `committedProductIds` die seven days after the *upload* too. Someone who reads "Committed" as "kept" comes looking for the receipt in a fortnight. |
| nothing about who uploaded | `createdBy` stored, never mapped | Cannot be built at all. There is no member id on the wire to join against, so the filename carries the row's identity — as the accessible name of the resume button and as the row's `title` — instead of a column the design has no width for. |
| no cancel affordance | `DELETE /:id`, 204 | Added, because a `reviewing` job otherwise sits in the list for a week with no way to stop it. It is behind a confirmation, and the copy says "stops" rather than "deletes": this is a **soft** cancel, the job stays in the list as `cancelled`, and nothing anywhere in the backend deletes an import job. |

## 12. Three decisions worth the argument

**`hasBeenEdited(job)` is `updatedAt > createdAt`, and that is a heuristic.** The brief asked for a
warning before remapping "a job whose rows have been edited". Nothing on the wire says a row was
edited — there is no flag, no revision count, and the row shaper carries neither. What does exist
is Mongoose timestamps: both are set to the same instant at insert and every mutating service call
bumps `updatedAt` (`service.ts:366,389,409,534`). So a later `updatedAt` means *something* was
written, and it cannot tell a row fix from an earlier remap. It is used only to add a second
sentence to a warning that is shown **either way** — the destruction is a property of the endpoint,
not of how much work has been done — and never to skip one.

**Columns before rows, as the wizard's default order.** `PATCH /columns` re-derives every
non-skipped row from `raw`, so the only order in which a remap costs nothing is the one that
settles the mapping first. Opening a job lands on step 2, not on the review table, and the way to
step 3 is a button that says the mapping looks right.

**The template download reaches the service directly, skipping the hooks layer.** A deliberate,
documented exception to `page -> components -> hooks -> services`:
`GET /products/import/template` answers raw `text/csv`, already bypasses the axios client (it is
`fetch`-based in the service for exactly that reason), and produces **no server state** to key,
cache or invalidate — only a file to hand to the browser. A `useMutation` wrapper would have been a
query-layer object with nothing to query. Local `{ busy, error }` state instead; the failure still
renders as an `ErrorCard` with the request id, because the service normalises it into an `ApiError`
by hand.

## 13. Small things learned

- **The upload seed is actually read.** `useUploadImport` seeds `importKeys.jobPage(job.id)` with
  the resolved defaults, and the wizard opens the job with `useImportJob(jobId)` and no params.
  Those hash to the same key, so going from "file dropped" to "columns on screen" costs zero extra
  requests. Passing any row filter at that call site would silently throw the seed away.
- **A client-side extension check earns its keep here specifically.** With no `fileFilter` on the
  endpoint, a `.pdf`, a `.txt` and a `.xls` all come back as `IMPORT_NO_ROWS` — "we could not read
  any rows out of that file" about a file that is full of rows. The check refuses those before the
  upload; every server refusal is still rendered, branched on `code`, with the request id kept.
- **The 429 gets its own sentence.** `lib/api/client` already toasts it, but a toast cannot say the
  thing that makes it surprising: the limiter is `keyBy: "organization"`, so twenty uploads are
  spent by the whole business and a colleague's failed attempts spend yours.
- **A 404 on `GET /:id` is written as expiry first.** It covers "no such job", "another business's
  job" and "aged out" with one code, and the seven-day TTL makes the third the likeliest by a
  distance — which "Import job not found" does not hint at even slightly.
- **`role="status"` is a biome error in this repo** (`lint/a11y/useSemanticElements`); `<output>`
  carries the role natively and is what the rest of the codebase already uses.
- **Committed and cancelled jobs are handed to `CommitBar`**, which already renders the receipt for
  one and a plain note for the other. The wizard contributes only the filename and the way out —
  two components each rendering their own version of the same receipt would eventually disagree.

## 14. Files

```
app/(app)/products/import/page.tsx          — requirePageAccess + ForbiddenScreen
app/(app)/products/import/page.test.tsx
features/product-import/components/
  import-wizard.tsx        — the shell, the four-step rail, ?job= in the URL
  upload-step.tsx          — drop zone, courtesy checks, template download
  previous-jobs.tsx        — the list, the expiry label, the cancel dialog
  column-map-step.tsx      — the inversion, the remap dialog, the refusals
  (+ a co-located .test.tsx for each)
```

One edit outside them: `features/products/components/products-page.tsx`, where the `Import` button
was `disabled` with `title="Coming soon"` and now links to `ROUTES.productImport`. It needed no
gate of its own — it already sits inside the `canCreate` block, and all ten import endpoints gate
on that same `products:create`.

---

# 2026-09-10 (later still) — the review and commit screens (steps 3 and 4)

`features/product-import/components/` — `review-step.tsx`, `commit-bar.tsx` and the four
supporting files they need. Written against
`docs/findings/slice4-import-live-observations.md`, whose §1 and §2 were the whole task.

Verified: `bunx tsc --noEmit` clean, `bunx biome check` clean over these files,
`bunx vitest run features/product-import` 133 tests green across 10 files, full suite
71 files / 646 tests green. The one repo-wide biome error is still the owner's stray
`console.log` in `app/(app)/customers/page.tsx`; untouched.

## 15. Translating the row `errors` needs `parsed`, not just the field key

The observation file says to switch on the field key because the key is reliable and the message
is not. True, and not sufficient: **one field key covers several different problems.** `name`
alone produced both of these live —

```
name: "Invalid input: expected string, received undefined"   (row 2, blank cell)
name: "Too big: expected string to have <=120 characters"    (row 14, 140 characters)
```

— and "Name is missing" vs "This name is too long" are not interchangeable sentences. The only
way to tell them apart without reading the message is to read the **value**, and that turns out
to work because of how the backend cleans a row.

`cleanRow` (`../Backend/src/services/import/clean.ts:118-160`) only writes a key into `parsed`
when the cell survived cleaning:

```ts
const name = collapse(get("name"));
if (name) parsed.name = name;           // blank/whitespace cell -> key absent
…
const costRaw = get("costPrice");
if (costRaw) {
  const n = cleanNumber(costRaw, style);
  if (n !== null) parsed.costPrice = n; // unparseable cell -> key absent too
}
```

So `parsed.name === undefined` **is** the blank cell, and a present value can be measured against
the mirrored bound. `row-message.ts` reads nothing but `field`, `parsed` and — where `columnMap`
names the header — the reviewer's own `raw` cell. There is a test asserting the translation is
identical when the API's prose is replaced with nonsense, because a translation that quietly
depended on the message would pass today and mislead after a zod upgrade with nothing failing.

The full mapping, for the record:

| field | what decides | sentence |
|---|---|---|
| `name` | absent | Name is missing |
| `name` | > 120 chars | This name is too long — 120 characters is the limit |
| `sellingPrice` / `costPrice` | absent, cell blank | Selling price / Cost price is missing |
| `sellingPrice` / `costPrice` | absent, cell had text | We could not read a selling price from “N/A” |
| `sellingPrice` / `costPrice` | < 0 · > 1e12 · > 2 dp | cannot be negative · is too large · can have at most 2 decimals |
| `quantity` | < 0 | Quantity cannot be negative |
| `quantity` | absent / > 1e9 / > 3 dp | missing (or unreadable-from-cell) · is too large · at most 3 decimals |
| `barcode` | < 4 · > 64 · charset | too short (4 minimum) · too long (64 limit) · only letters, numbers, dots, dashes and underscores |
| `barcode` | value passes all three | This barcode is on more than one row of this file |
| `category` | > 60 chars | This category name is too long — 60 characters is the limit |
| `category` | value within bounds | This category does not exist yet, and you cannot create new categories |
| `unit` | blank · > 20 chars | Unit is missing · This unit is too long — 20 characters is the limit |
| `lowStockThreshold` | absent · < 0 · non-integer · > 1e9 | missing/unreadable · cannot be negative · must be a whole number · is too high |
| `trackStock` | absent · present | We could not tell from “x” whether this item is stock-tracked — use yes or no · Track stock must be yes or no |
| `description` | > 2000 chars | This description is too long — 2,000 characters is the limit |
| `_` | — | We could not read this row |

### The raw cell separates two problems `parsed` alone cannot

`sellingPrice` absent means "the cell was blank" **or** "the cell said `N/A` and nothing numeric
survived" — identical `parsed`, identical zod message, different sentences to a shopkeeper. The
column map is field -> header, so `row.raw[columnMap.sellingPrice]` recovers what they typed.
Worth noting the direction, because inverting it silently produces the vaguer sentence instead of
failing.

### Two of the eleven keys are identified by elimination, and that is deliberate

`errors.barcode` has four documented causes: three zod rules (4..64, charset) and the file-level
duplicate written by the service directly (`product-import.service.ts:152-155`). A barcode value
that passes all three rules and is still flagged can only be the duplicate. Same shape for
`errors.category`: over 60 characters, or the literal `"Unknown category"` the *commit* writes
when the caller lacks `categories:create` (`service.ts:45,530-531`).

This is inference, not a wire fact, and it is written down here because it is the one place in
the mapping where a future backend change could make a sentence wrong rather than merely vague.
Both branches are commented at the switch with their source lines.

### The duplicate message reads well and is still not shown in the Message column

`"Duplicated in the file (rows 6, 7)"` is the one message fit for a human — except its numbers
are **0-based data indexes**, so those are the spreadsheet's rows 8 and 9 (§7 above, contract
Trap 6). Putting it in the Message column would send the reviewer to the wrong two lines. So the
column says *"This barcode is on more than one row of this file"*, the server's sentence stays in
the expandable details and in the pill's `title`, and a line underneath it says the numbers count
from the first data row. That line renders only when a duplicate message is actually present.

## 16. What the conflict banner does about the parenthetical

Observation §2: `conflict` is `{ existingProductId, existingName }` and the canvas draws
`(USD 12.40, 3 pcs)` beside the name. Chosen: **the name always, the figures on demand.**
`ConflictBanner` renders the name with no figures at all plus a *Compare* button; pressing it
enables `useProduct(existingProductId)` for that one row and shows two **labelled** columns —
"Already in your products" and "This row in your file" — with price, cost and stock on each.

Two halves rather than one merged line, because the imported row's price and the live product's
price are different numbers and the observation file is explicit that showing one where the other
belongs defeats the purpose. A fifty-conflict file costs zero requests until someone opens a
specific conflict. There is a test asserting the imported row's `10.50` appears nowhere in the
collapsed banner.

A resolved conflict also gets a sentence of its own: **"Decided rows stay listed as conflicts
until the import runs, so this count will not go down."** Nothing else on the screen can convey
that — `status` stays `"conflict"` and `counts.conflict` does not move — and silence there reads
as a save that failed.

## 17. A number already in the file cannot be un-set through `PATCH`

Not in the contract and easy to ship as a silent no-op. `editRow` merges
(`merged = { ...row.parsed, ...patch }`, `service.ts:372-394`) and `importRowPatchSchema` has no
`null` for any field, so there is no way to *remove* a numeric value the file supplied. Emptying
the box and saving would drop the field from the diff and look like an edit that saved nothing.

`FixRowDialog` refuses it with a sentence instead. The one field that can genuinely be cleared is
the category, via the empty string — `resolveRowCategories` deletes both `parsed.category` and
`parsed.categoryId` when the trimmed name is falsy — and that is the only place `""` is sent.

## 18. More than 200 conflicts is a realistic file, so the commit bar pages

§3 above accepted `conflicts_not_loaded` as the correct answer beyond one page at the 200 cap.
That is right as far as `commitReadiness` goes, but it leaves a real user stuck: a shop
re-uploading its whole catalogue has one conflict per barcode it already stocks, which on a
2,000-row file can be most of them. A Commit button disabled for ever by an answer the client
simply had not finished fetching is worse than the failed commit the refusal exists to prevent.

So `CommitBar` walks the conflict pages and accumulates them, and **the accumulator's identity is
`job.updatedAt`**. That part is load-bearing: every row write re-reconciles the whole file, and
any `PATCH` on a conflicted row silently discards its resolution — so a page fetched before a
write could otherwise sit in the accumulated list claiming a decision that no longer exists,
which is exactly the false "yes" `commitReadiness` was built to refuse. `updatedAt` moves on
every one of those writes, so when it changes the accumulation restarts from page 1.

## 19. What the design asks for that the API still cannot give

Beyond the two already recorded, found while building these two screens:

- **"3 conflicts resolved" is not derivable from the job at all.** The canvas puts it in the
  step-4 summary beside `ready` and `skipped`, which *are* in `counts` — but a resolution is
  per-row and `publicJobSummary` carries none. The bar renders `… of 3 conflicts resolved` with
  an ellipsis while the conflict rows load: "the summary can prove a no but never a yes" showing
  up in the copy rather than only in the button state.
- **"Import 184 products" understates a commit that has `update` resolutions.** `counts.ready` is
  the create count; rows resolved `"update"` also write, and no single tally covers both. The
  button keeps the canvas's number and a muted line above it says how many rows will change a
  product already stocked.
- **The Message column is one pill and a row can have several messages.** A row can carry several
  `errors` keys *and* notes at once. The first message is the pill; the rest are behind a
  `+N more` toggle that expands a full-width row — which is also where the raw messages live.
- **The canvas draws no per-row actions.** A reviewer has to be able to fix and skip a row from
  the list, and the only buttons drawn are the conflict banner's. An eighth column was added.
- **No "Ready" badge.** The canvas gives every row a message pill; a table where every good row
  says "Ready" cannot be scanned for the bad ones, so a clean `ready` row shows an em dash.

## 20. Small decisions

| Decision | Why |
|---|---|
| A real `<table>` rather than `components/shared/data-table` | The conflict banner and the message details are rows that **span every column**, which a column-per-cell renderer cannot express. A grid of `div`s could, but the one screen whose whole subject is "which line of my spreadsheet is wrong" is the last place to throw away row and column semantics. |
| The message pill carries `data-tone="problem" \| "note"` | "A note must never be styled as a fault" is a rule whose only evidence is a class string, and class strings are exactly what a refactor breaks silently. The tone is now an attribute a test holds on to. |
| Row filters in the URL, keyed `rowStatus` / `rowPage` / `rowLimit` | Repo convention, plus the wizard shell around this owns the query string too — a bare `page` would collide with the jobs list beside it. |
| The page-size selector offers 200 | It is the only place in the app where the cap is not 100, and offering it is what makes the difference real rather than a constant nobody exercises. |
| Restoring a skipped row sends `{ unit }` and nothing else | There is no un-skip endpoint (Trap 9). `parsed.unit` is the one field `cleanRow` always sets — it defaults to `"pcs"` — so it is a guaranteed-present no-op write that still triggers the re-validation which revives the row. Echoing `unit`, `trackStock` and `quantity` together, as the stale Trap 1 advises, would write two fields nobody touched. |
| `FixRowDialog` renders all ten fields, not just the broken ones | The problems are listed at the top in plain language and the offending fields are marked, but a reviewer fixing a price often wants to correct the name in the same pass, and a dialog that hides the rest forces a second round trip. |
| The dialog re-reads its row out of the freshly fetched page | A file-wide reconciliation can move a row between the click and the render, and diffing against a stale `parsed` sends a patch against values the server no longer holds. |

## 21. Files

```
features/product-import/components/
  row-message.ts              — the translator, plus `importFieldLabel`
  row-message.test.ts         — tested against the five strings observed live
  review-step.tsx             — step 3: tabs, table, paging, dialogs
  import-rows-table.tsx       — the seven-column table + full-width rows
  conflict-banner.tsx         — the conflict row and its compare-on-demand
  fix-row-dialog.tsx          — PATCH one row, diff only
  commit-bar.tsx              — step 4, and `blockerText`
  *.test.tsx                  — one per component
```

Nothing outside `features/product-import/components/` was changed.
