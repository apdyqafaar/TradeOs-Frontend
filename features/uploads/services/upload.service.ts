import type {
  CreateUploadInput,
  ListUploadsParams,
  Upload,
  UploadGalleryItem,
} from "@/features/uploads/types";
import { apiDelete, apiGetList, apiPost } from "@/lib/api/client";
import type { ObjectId, Paginated } from "@/lib/api/types";

/**
 * The three `/uploads` rows of `docs/API-ROUTES.md`, and nothing else.
 *
 * All three are gated on **`uploads:create`** — there is no `uploads:view`, so
 * a role that cannot upload cannot list the gallery either and gets a 403 from
 * `GET /uploads`. That is why the picker is wrapped in a `PermissionGate` for
 * `uploads:create` at its call sites rather than showing a read-only gallery.
 *
 * No React, no hooks, no toasts: the response interceptor in `lib/api/client`
 * has already unwrapped the envelope and normalised every failure into an
 * `ApiError`.
 */

const BASE = "/uploads";

/** Query-string shape: `attached` is `"true"`/`"false"` on the wire, never a boolean. */
interface ListUploadsQuery {
  page?: number;
  limit?: number;
  purpose?: ListUploadsParams["purpose"];
  attached?: "true" | "false";
}

const toListQuery = (params: ListUploadsParams): ListUploadsQuery => ({
  page: params.page,
  limit: params.limit,
  purpose: params.purpose,
  // `listUploadsQuerySchema` is `.strict()` and types `attached` as
  // `z.enum(["true", "false"])`. Axios would stringify a boolean to the same
  // thing, but doing it here means the wire shape is stated where the endpoint
  // is named instead of resting on a serializer default.
  attached:
    params.attached === undefined
      ? undefined
      : params.attached
        ? "true"
        : "false",
});

/**
 * `GET /uploads` — the gallery, newest first, paginated (default 20, max 100).
 *
 * **Organization-wide**, not per member: every image the business has
 * uploaded, whoever uploaded it. Note that the pending-upload cap this list
 * helps you clear is per *member*, so a full page of unattached images does
 * not mean you are the one at the limit.
 *
 * The query goes in `{ params }` — an axios *request config*. Passing the
 * filter object as the second argument type-checks (every field of an
 * `AxiosRequestConfig` is optional) and sends no query string at all, which
 * reads as a broken filter rather than a bug.
 */
export const listUploads = (
  params: ListUploadsParams = {},
): Promise<Paginated<UploadGalleryItem>> =>
  apiGetList<UploadGalleryItem>(BASE, { params: toListQuery(params) });

/**
 * `POST /uploads` — the only multipart request in this app.
 *
 * **Two multipart parts, named exactly `file` and `purpose`.** The binary part
 * is read by `multer.single("file")`
 * (`Backend/src/middleware/upload.middleware.ts:20`); any other field name is
 * a 422, not a 400 with an explanation. `purpose` is an ordinary text field
 * that multer puts on `req.body`, which is why `validate` runs *after* multer
 * on this one route (see the comment in `Backend/src/routes/v1/upload.route.ts`).
 *
 * ### Why `Content-Type: null` is here, and why it must not be a string
 *
 * The shared axios instance sets `headers: { "Content-Type": "application/json" }`
 * as an instance default. Axios's own `transformRequest` reads that header
 * *before* the adapter runs and does this
 * (`node_modules/axios/dist/browser/axios.cjs:2796-2800`):
 *
 * ```js
 * const isFormData = utils.isFormData(data);
 * if (isFormData) {
 *   return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
 * }
 * ```
 *
 * So posting a `FormData` through this client *without* overriding the header
 * silently converts it to JSON — verified, the body on the wire becomes
 * `{"file":{},"purpose":"product"}`: the file is gone, multer sees no
 * multipart stream, and the request fails in a way that looks nothing like a
 * missing header. That is the trap this comment exists for.
 *
 * Setting the header to a literal `"multipart/form-data"` is the other half of
 * the trap: a multipart body is unreadable without the `boundary=` parameter,
 * and only the thing that serialises the body can know it. Sending the bare
 * type produces a body the server cannot parse.
 *
 * `null` is the value that means *remove this header*: axios's
 * `AxiosHeaders.toJSON` drops null entries, and `dispatchRequest`'s
 * `setContentType('application/x-www-form-urlencoded', false)` — the
 * non-rewriting default it applies to every POST — leaves a null alone while
 * it would happily fill in an `undefined`. The XHR adapter then clears the
 * content type for a `FormData` body outright ("browser/web worker/RN handles
 * it", `axios.cjs:3599-3607`) and the browser sets
 * `multipart/form-data; boundary=…` itself.
 *
 * `timeout` is raised from the client's 30 s default because this is the one
 * request whose size is chosen by the user: 10 MB over a phone connection can
 * take minutes, and a timeout here throws away an upload that was working.
 */
export const createUpload = ({
  file,
  purpose,
}: CreateUploadInput): Promise<Upload> => {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", purpose);

  return apiPost<Upload>(BASE, form, {
    headers: { "Content-Type": null },
    timeout: 120_000,
  });
};

/**
 * `DELETE /uploads/:id` — 200 with no payload, not a 204.
 *
 * Only an **unattached** upload can be deleted: one a product or an
 * announcement has claimed comes back as 409 `UPLOAD_ATTACHED` and has to be
 * detached through its owner first. A 404 covers both "no such upload" and
 * "belongs to another business", so an id cannot be probed.
 *
 * The row is removed only once both S3 objects are confirmed gone; a storage
 * failure is surfaced as 502 `STORAGE_ERROR` rather than swallowed.
 */
export const deleteUpload = (id: ObjectId): Promise<void> =>
  apiDelete<void>(`${BASE}/${id}`);
