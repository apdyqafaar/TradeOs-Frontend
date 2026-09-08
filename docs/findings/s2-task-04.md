# Slice 2, Task 4 — uploads slice and the ImagePicker

## Posting `FormData` through the shared axios client silently sends JSON instead

**What:** `lib/api/client.ts` creates the instance with `headers: { "Content-Type": "application/json" }`. Axios's default `transformRequest` reads that header *before* any adapter runs and, when the body is a `FormData`, **converts it to JSON**:

```js
const isFormData = utils.isFormData(data);
if (isFormData) {
  return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
}
```

So `apiPost("/uploads", form)` sends `{"file":{},"purpose":"product"}` with `Content-Type: application/json`. The file is gone. Multer sees no multipart stream and the request fails as a validation error that says nothing about a header.

The fix is a per-request `headers: { "Content-Type": null }` — **`null`, not `undefined`, and never the literal string**:

- `null` removes the header. `AxiosHeaders.toJSON` drops null entries, and `dispatchRequest`'s `setContentType('application/x-www-form-urlencoded', false)` (the non-rewriting default it applies to every POST) leaves a null alone.
- `undefined` also survives `transformRequest`, but that same `dispatchRequest` line then fills in `application/x-www-form-urlencoded`, because its guard treats `undefined` as "unset" and `null` as "set".
- A literal `"multipart/form-data"` is unparseable without the `boundary=` parameter, which only the thing serialising the body can know.

With the header removed, the XHR adapter clears the content type for a `FormData` body outright — `headers.setContentType(undefined); // browser/web worker/RN handles it` — and the browser writes `multipart/form-data; boundary=…` itself.

**Evidence:** `node_modules/axios/dist/browser/axios.cjs:2796-2800` (the JSON conversion), `:5061` (the x-www-form-urlencoded default), `:3599-3607` (the adapter clearing it for FormData). Probed directly against a copy of this app's instance config with a stub adapter, axios 1.20.0:

| request | body seen by the adapter | Content-Type |
|---|---|---|
| no override | `"{\"file\":{},\"purpose\":\"product\"}"` | `application/json` |
| `"Content-Type": undefined` | `FormData` | `application/x-www-form-urlencoded` |
| `"Content-Type": null` | `FormData` | `null` |

**So what:** `features/uploads/services/upload.service.ts` does this and carries the explanation. **`lib/api/client.ts` does not need a change for uploads to work, but it should get one anyway** — and this lane did not make it. The instance-level `"Content-Type": "application/json"` is *redundant*: axios sets exactly that header itself for any plain-object body (`axios.cjs:2841-2845`, `headers.setContentType('application/json', false)`). Deleting that one line from the `axios.create` call would leave every existing JSON request byte-identical and remove the trap for the next person who posts a form. No test asserts the header today (`grep -n "Content-Type" lib/api/client.test.ts` is empty). If it stays, the next multipart caller who forgets the override gets a request that fails with no clue why — the failure looks like a backend bug, not a header.

## The multipart fields are `file` and `purpose`, and a wrong name is a bare 422

**What:** `POST /uploads` reads exactly two parts: the binary part **`file`** and the text field **`purpose`** (`product | announcement | project | logo`). Any other field name, a second file, or a missing file is a 422 whose `errors.file` reads "Expected a single multipart file field named 'file'" — there is no error code that distinguishes it from any other validation failure.

`purpose` cannot be sent as a query parameter or a JSON body: `validate({ body: uploadBodySchema })` runs *after* multer on this one route precisely because `purpose` does not exist on `req.body` until multer has parsed the stream, and the schema is `.strict()`.

**Evidence:** `Backend/src/middleware/upload.middleware.ts:6,8,20,27`; `Backend/src/routes/v1/upload.route.ts:34-43` and its route comment; `Backend/src/validators/upload.validation.ts:10`.

**So what:** Field names are the contract. If a future caller builds the form by hand, copy `createUpload` in `features/uploads/services/upload.service.ts` rather than re-deriving it.

## Two size limits that are not the same limit

**What:** **10 MB** (`MAX_UPLOAD_BYTES`) is enforced by multer and answers **413 `FILE_TOO_LARGE`**. **50 megapixels** (`limitInputPixels`) is enforced by sharp and answers **422 `IMAGE_TOO_LARGE`**. A 4 MB image can fail the second while a 9 MB one passes both, so they need two different messages.

**Evidence:** `Backend/src/middleware/upload.middleware.ts:6`; `Backend/src/services/upload.service.ts:34,77-88`.

**So what:** Both constants live in `features/uploads/types.ts` and the browser checks the byte limit before uploading — on a phone connection a 20 MB refusal costs a minute of someone's data to learn something the browser already knew. The pixel limit cannot be checked without decoding, so it is only ever handled as a response.

## Only JPEG, PNG and WebP — and the format is decided by decoding, not by the name

**What:** `ACCEPTED_FORMATS` is `jpeg`, `png`, `webp`. sharp reads the actual bytes, so renaming `photo.heic` to `photo.jpg` changes nothing; it is still 422 `UNSUPPORTED_IMAGE`. **HEIC is what an iPhone shoots by default**, so this is the single most likely upload failure a real user will hit. Everything stored is re-encoded to WebP at quality 82 inside a 1600 px box with a 400 px thumbnail beside it, EXIF orientation applied and all other metadata (GPS included) stripped.

**Evidence:** `Backend/src/services/upload.service.ts:27-32, 73-100, 105-118`.

**So what:** The picker's message names HEIC and says what to do — export as JPEG, or set Camera → Formats to Most Compatible — instead of printing the code. Note also that `accept="image/jpeg,image/png,image/webp"` on a file input **does not apply to a dropped file**, so the drop path needs its own check; that is the path the test exercises.

## Every code the three upload routes answer with

**What:**

| Route | Status | Code | When |
|---|---|---|---|
| POST | 503 | `STORAGE_NOT_CONFIGURED` | `getStorage()` is null — no S3 keys |
| POST | 409 | `UPLOAD_PENDING_LIMIT` | Already holding 5 unattached uploads; `details: { pending, max }` |
| POST | 422 | `UNSUPPORTED_IMAGE` | Not JPEG/PNG/WebP after decoding |
| POST | 422 | `IMAGE_TOO_LARGE` | Over 50 megapixels |
| POST | 422 | `VALIDATION_ERROR` | No file part, >1 file, wrong field name, or a `purpose` outside the enum |
| POST | 413 | `FILE_TOO_LARGE` | Over 10 MB |
| POST | 502 | `STORAGE_ERROR` | The thumbnail write to S3 failed (the main object is best-effort deleted) |
| POST | 429 | `TOO_MANY_REQUESTS` | 100 uploads / 15 min, keyed by organization |
| DELETE | 404 | `NOT_FOUND` | No such upload, or another business's |
| DELETE | 409 | `UPLOAD_ATTACHED` | Something still uses it; detach it there first |
| DELETE | 502 | `STORAGE_ERROR` | S3 delete failed — the row is kept deliberately, so the orphan sweep still has a record |
| GET | — | — | No domain failure of its own |

All three are 403 without `uploads:create`, and 401 without a session.

**Evidence:** `Backend/src/services/upload.service.ts`, `Backend/src/middleware/upload.middleware.ts`, `Backend/src/util/errors.ts` (for the status each error class carries), `Backend/src/routes/v1/upload.route.ts:39`. Every one of these already exists in `API_ERROR_CODE` in `lib/api/errors.ts`.

## `GET /uploads` never returns `STORAGE_NOT_CONFIGURED`

**What:** The plan's Task 4 test comment says "every upload route answers 503 STORAGE_NOT_CONFIGURED" without S3 keys. It is not true. `listUploadsForOrg` only reads Mongo, and `deleteUploadForOrg` skips storage entirely when `getStorage()` is null. **Only `POST /uploads` 503s.** On a dev machine the gallery therefore loads normally (usually empty) and the 503 arrives on the first upload attempt.

**Evidence:** `Backend/src/services/upload.service.ts:56-59` (the only `ServiceUnavailableError`), `:196-210` (the list path), `:169-190` (the delete path).

**So what:** `<ImagePicker>` renders the calm "Image uploads are not set up" state when the code appears on **either** the query or the create mutation, so it is right whichever way the plan's test drives it and right in production. The test kept from the plan drives it through the query.

## The gallery has no `attached` boolean, and a member's pending count is not the list's length

**What:** The plan's interface says `Upload = { …; attached: boolean; … }`. The wire has **`attachedTo: { model, id } | null`** plus `uploadedBy: { memberId, name }`, and the create response has neither. Also, the 5-upload pending cap is **per member** while `GET /uploads` is **per organization** — so a pane full of unattached images does not mean you are the one at the limit, and clearing someone else's does not help you.

**Evidence:** `Backend/src/db/actions/upload.actions.ts:23-32` (create response) and `:171-194` (gallery row); `Backend/src/services/upload.service.ts:34-38, 62-70`.

**So what:** `features/uploads/types.ts` keeps the wire shape (`Upload` for the create response, `UploadGalleryItem` for a row) rather than flattening to `attached`, so a UI can say "in use by a product" instead of "in use". Deviation from the plan, deliberate.

## There is no way to turn an attached upload id back into a URL

**What:** The API has exactly three upload rows — no `GET /uploads/:id` — and the gallery filtered to `attached=false` cannot contain an image a product already owns. So `<ImagePicker value={ids}>` on an **edit** form has ids it cannot draw.

**Evidence:** `docs/API-ROUTES.md` § features/uploads (three rows); `Backend/src/routes/v1/upload.route.ts` has no `/:id` GET.

**So what:** `<ImagePicker>` takes an optional `known?: { uploadId, url, thumbUrl }[]`. A product already carries `images: { uploadId, url, thumbUrl }[]`, so the edit form passes that straight through. Without it the tiles render as numbered placeholders that can still be reordered and removed — degraded, never broken. Task 6 should pass `known={product.images}`.

## `createQueryKeys` exposes `lists` as an array, and an interface will not satisfy `list()`

**What:** Two things bite in the same file. `all`, `lists` and `details` are readonly **arrays**, not functions — `keys.lists()` does not compile. And `list()` takes `QueryKeyParams = Record<string, unknown>`, which an **interface** is not assignable to: TypeScript gives implicit index signatures to anonymous object types and type aliases but never to interfaces, so `keys.list(params)` fails and `keys.list({ ...params })` compiles.

**Evidence:** `lib/query/keys.ts:17-27`. Reported by the lead as having already cost two slices a failing typecheck, from a scaffolder template that has since been fixed.

**So what:** `features/uploads/keys.ts` wraps the helper so that `lists()` and `list(params)` both read as functions, and spreads the params. `features/categories/keys.ts` uses the bare helper and writes `categoryKeys.lists` — both are correct; do not "fix" one to match the other without changing its call sites.

## The picker is inline, not a dialog

**What:** The plan describes "two panes in a dialog", but `components/ui/` has no dialog primitive vendored (there is a `sheet.tsx` and nothing else modal), and **the plan's own test asserts the counter and the add control are visible without opening anything** — `screen.getByText(/5 of 5/i)` and `queryByLabelText(/add image/i)` immediately after render. A modal-gated picker fails that test.

**Evidence:** `ls components/ui` — no `dialog.tsx`; the plan's Task 4 Step 1 test.

**So what:** Both panes render inline: selected tiles with move/remove controls, then "Your recent uploads". If a dialog is wanted later, vendor `dialog` from shadcn first and keep the inline component as the dialog's body.

## `<img>`, not `next/image`, for upload thumbnails

**What:** `next.config.ts` builds `images.remotePatterns` from `NEXT_PUBLIC_S3_HOSTNAME` and leaves it **empty when that variable is unset**, which is every development machine. `next/image` throws on a host that is not configured, so it would turn a missing env var into a crashed form.

**Evidence:** `next.config.ts:10, 40-43`.

**So what:** The tiles use `<img>` with a `// biome-ignore lint/performance/noImgElement:` and the reason. Verified the rule is real and enabled here (`bunx biome explain noImgElement` → recommended in the `next` domain), so the suppression is doing work rather than decorating. Revisit when the S3 hostname is a settled part of the environment.

## One upload per request, because React Query's per-call `onSuccess` belongs to the latest `mutate`

**What:** `multer.single("file")` takes one file, and calling `mutate` several times on one mutation instance overwrites the per-call callbacks — the earlier calls' `onSuccess` never runs, so their new upload ids are lost and never reach `onChange`.

**Evidence:** `Backend/src/middleware/upload.middleware.ts:8` (`limits: { files: 1 }`); TanStack Query v5 `MutationObserver.mutate`, which assigns `this.mutateOptions = options` per call.

**So what:** The picker uploads the first dropped file and tells the user, in words, to add the rest one at a time. If multi-file upload is ever wanted, it needs either one mutation instance per file or a `mutateAsync` loop — not a `for` loop over `mutate`.
