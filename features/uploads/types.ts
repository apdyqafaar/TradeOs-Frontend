import type { ObjectId, PaginationParams } from "@/lib/api/types";

/**
 * What an image is *for*. The API stores it on the row and puts it in the S3
 * key (`org/<organizationId>/<purpose>/<32-hex>.webp`), so it is not a client
 * hint — `POST /uploads` rejects anything outside this set
 * (`Backend/src/validators/upload.validation.ts:10`).
 */
export type UploadPurpose = "product" | "announcement" | "project" | "logo";

/** The four owners an upload can be claimed by, once something attaches it. */
export type AttachedToModel =
  | "Product"
  | "Announcement"
  | "Project"
  | "Organization";

/**
 * What `POST /uploads` answers — `toUploadResponse` in
 * `Backend/src/db/actions/upload.actions.ts:23-32`.
 *
 * Every stored image is a **WebP**, whatever was sent: the service decodes the
 * upload with sharp, honours its EXIF orientation, strips the rest of the
 * metadata (GPS included) and re-encodes at quality 82 into a 1600 px box,
 * with a 400 px thumbnail beside it. So `url` and `thumbUrl` are two different
 * objects, not one image at two sizes, and `size`/`width`/`height` describe
 * the **converted** main image — never the file the user picked.
 */
export interface Upload {
  id: ObjectId;
  purpose: UploadPurpose;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  /** Bytes of the stored WebP, not of the uploaded original. */
  size: number;
  /** ISO 8601 string, not a `Date`. */
  createdAt: string;
}

/**
 * A row of `GET /uploads` — `toUploadGalleryItem`
 * (`Backend/src/db/actions/upload.actions.ts:171-194`). Everything in
 * `Upload`, plus the two facts the gallery exists to show.
 *
 * **There is no `attached: boolean` on the wire** (the plan's interface says
 * there is — see `docs/findings/s2-task-04.md`). What arrives is `attachedTo`,
 * either `null` or the resource that claimed the image; `attached` is
 * `attachedTo !== null`. Keeping the wire field rather than flattening it is
 * what lets a UI say *"in use by a product"* instead of *"in use"*.
 */
export interface UploadGalleryItem extends Upload {
  /**
   * The member who uploaded it. `name` is `"Removed member"` when the Member
   * row no longer populates — a should-never-happen guard on the API side, not
   * a state to design for.
   */
  uploadedBy: { memberId: ObjectId; name: string };
  attachedTo: { model: AttachedToModel; id: ObjectId } | null;
}

/**
 * `GET /uploads?page=&limit=&purpose=&attached=`.
 *
 * `attached` is a **boolean here and a string on the wire**: the query schema
 * is `z.enum(["true", "false"])` because query strings have no booleans
 * (`upload.validation.ts:21`). The service does that conversion so no caller
 * has to remember it. Omitting it means "all", not "unattached".
 *
 * `limit` is capped at 100 by `paginationQuerySchema`; the default is 20.
 */
export interface ListUploadsParams extends PaginationParams {
  purpose?: UploadPurpose;
  attached?: boolean;
}

/** The two multipart fields `POST /uploads` reads. See the service for why. */
export interface CreateUploadInput {
  /** The multipart part named `file` — multer's `singleImageUpload`. */
  file: File;
  /** The text field named `purpose`, validated after multer has parsed it. */
  purpose: UploadPurpose;
}

/**
 * The formats the API will actually store, taken from `ACCEPTED_FORMATS` in
 * `Backend/src/services/upload.service.ts:32` — and **`sharp` decides by
 * decoding the bytes, never by the extension or the declared MIME type**, so
 * renaming `photo.heic` to `photo.jpg` changes nothing.
 *
 * The omission that matters: **HEIC**, which is what an iPhone shoots by
 * default. It is a 422 `UNSUPPORTED_IMAGE`, and the message a person sees has
 * to say what to do about it, not repeat the code.
 */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** The `accept` attribute for a file input, from the list above. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * `MAX_UPLOAD_BYTES` — 10 MB, enforced by multer
 * (`Backend/src/middleware/upload.middleware.ts:6`). Over it is a 413
 * `FILE_TOO_LARGE`, and multer aborts the stream, so the bytes are uploaded
 * before the refusal arrives. Checking it in the browser first is what saves
 * someone on a phone connection a pointless 20 MB round trip.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * A **separate, larger** limit that has nothing to do with file size: sharp
 * refuses to decode an image with more than 50 megapixels
 * (`limitInputPixels`), which is a 422 `IMAGE_TOO_LARGE`. A 4 MB image can
 * fail this while a 9 MB one passes, so the two limits need two messages.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/**
 * A member may hold at most five uploads that nothing has attached yet
 * (`MAX_PENDING_UPLOADS_PER_MEMBER`, `Backend/src/services/upload.service.ts:40`).
 * The sixth is a 409 `UPLOAD_PENDING_LIMIT`, whose `details` carry
 * `{ pending, max }`.
 *
 * **Per member, but the gallery is per organization.** So the way out is to
 * use or delete one of *your own* unattached images, and the list of
 * unattached images on screen may include other people's, which do not count
 * against you.
 */
export const MAX_PENDING_UPLOADS = 5;
