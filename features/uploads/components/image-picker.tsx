"use client";

import { cn } from "cn";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  ImagePlus,
  Trash2,
  X,
} from "lucide-react";
import { type DragEvent, type ReactNode, useId, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateUpload,
  useDeleteUpload,
} from "@/features/uploads/hooks/use-upload-mutations";
import { useUploads } from "@/features/uploads/hooks/use-uploads";
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_PIXELS,
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_BYTES,
  type Upload,
  type UploadPurpose,
} from "@/features/uploads/types";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";

/**
 * How many unattached images the "recent uploads" pane shows. The pending cap
 * is five *per member* and the gallery is organization-wide, so this is a
 * couple of colleagues' worth — not a paginated browser. A picker that needs
 * page two is a sign this should have been a full gallery screen.
 */
const GALLERY_LIMIT = 24;

/** The default, and what a product allows (`images` is max 5 in the product validator). */
const DEFAULT_MAX = 5;

/**
 * One message, said the way a person would say it.
 *
 * HEIC is the case worth wording carefully: it is what an iPhone shoots by
 * default, the API refuses it (`ACCEPTED_FORMATS` is jpeg/png/webp only), and
 * "UNSUPPORTED_IMAGE" tells someone holding a photo of their own stock nothing
 * at all about what to do next.
 */
const UNSUPPORTED_MESSAGE =
  "Only JPEG, PNG and WebP images can be stored. An iPhone shoots HEIC by default — export the photo as a JPEG, or switch Camera settings to Most Compatible, then try again.";

const megabytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * What to say about a file before it is sent.
 *
 * Both limits are the API's, checked here only so the answer arrives before
 * the bytes do — on a phone connection a 20 MB refusal costs a minute of
 * someone's data to learn something the browser already knew.
 *
 * An **empty `file.type`** is not refused: the browser only guesses the type
 * from the extension, so a renamed or unknown file arrives as `""`. The API
 * decides by decoding the bytes, which is the only check that is actually
 * true, so an unknown type is sent and left to it.
 */
const refuseLocally = (file: File): string | null => {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${megabytes(file.size)}. Images must be ${megabytes(MAX_UPLOAD_BYTES)} or smaller.`;
  }
  if (
    file.type &&
    !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)
  ) {
    return `${file.name} can't be used. ${UNSUPPORTED_MESSAGE}`;
  }
  return null;
};

/**
 * What to say about a refusal that came back from the API.
 *
 * Branching on `code`, never on `message` (CLAUDE.md). `error.details` is used
 * where the server sent it — `UPLOAD_PENDING_LIMIT` carries `{ pending, max }`
 * — because the server's number is the true one.
 */
const uploadRefusal = (error: ApiError): string => {
  switch (error.code) {
    case API_ERROR_CODE.UPLOAD_PENDING_LIMIT: {
      const max =
        typeof error.details?.max === "number"
          ? error.details.max
          : MAX_PENDING_UPLOADS;
      return `You are holding ${max} uploaded images that nothing is using yet, which is the limit. Attach or delete one of the recent uploads below, then try again.`;
    }
    case API_ERROR_CODE.UNSUPPORTED_IMAGE:
      return UNSUPPORTED_MESSAGE;
    case API_ERROR_CODE.IMAGE_TOO_LARGE:
      return `That image is more than ${MAX_IMAGE_PIXELS / 1_000_000} megapixels, which is too many to process. Scale it down and try again.`;
    case API_ERROR_CODE.FILE_TOO_LARGE:
      return `Images must be ${megabytes(MAX_UPLOAD_BYTES)} or smaller.`;
    case API_ERROR_CODE.STORAGE_ERROR:
      return "The image store did not accept the file. Try again in a moment.";
    default:
      return error.message;
  }
};

/** A thumbnail this picker can render, however it came to know about it. */
export interface KnownImage {
  uploadId: ObjectId;
  url: string;
  thumbUrl: string;
}

export interface ImagePickerProps {
  /** What the images are for. Sent with every upload and used to filter the gallery. */
  purpose: UploadPurpose;
  /** Upload **ids**, in display order. The first one is the main image. */
  value: ObjectId[];
  /** The new order, after an add, a remove or a move. */
  onChange: (ids: ObjectId[]) => void;
  /** How many images the owning resource accepts. A product takes five. */
  max?: number;
  /**
   * Thumbnails for ids this picker cannot look up on its own.
   *
   * The gallery lists **unattached** uploads, and an image already saved on a
   * product is attached — so on an edit form the ids in `value` resolve to
   * nothing here. The product carries `images: { uploadId, url, thumbUrl }[]`
   * of its own; hand that over and the tiles have pictures in them. There is
   * no `GET /uploads/:id` to fall back on (`docs/API-ROUTES.md` has three
   * upload rows), so without this a saved image renders as a placeholder tile
   * that can still be reordered and removed — degraded, never broken.
   */
  known?: KnownImage[];
  /** Set while the owning form is submitting. */
  disabled?: boolean;
  className?: string;
}

/**
 * Pick images for a product, an announcement, a project or a business logo.
 *
 * **Ids are the currency, not URLs.** `value` is upload ids in display order
 * and `onChange` reports the new order, because `POST /products` takes
 * `images: ObjectId[]` and the API denormalises the URLs onto the product when
 * it attaches them. A picker that dealt in URLs would have to map back to ids
 * at submit time, which is where the order gets lost.
 *
 * **All three upload routes are gated on `uploads:create`** — there is no
 * `uploads:view` — so this whole component belongs inside a
 * `<PermissionGate permission={PERMISSIONS.UPLOADS_CREATE}>` at its call sites.
 * It deliberately does not call `useCan` itself: a component that hides itself
 * is one a form cannot lay out around, and the 403 is still handled here in
 * case a stale session gets past the gate.
 *
 * **Not a dialog**, though the plan describes one: `components/ui/` has no
 * dialog primitive vendored, adding one is another lane's file, and the plan's
 * own test asserts the counter and the add control are visible without opening
 * anything. Both panes are inline instead — see `docs/findings/s2-task-04.md`.
 */
export function ImagePicker({
  purpose,
  value,
  onChange,
  max = DEFAULT_MAX,
  known,
  disabled = false,
  className,
}: ImagePickerProps) {
  const inputId = useId();
  const [issue, setIssue] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * Uploads made in this session. The gallery query is invalidated on success
   * and will report them a moment later; this makes the tile show its picture
   * immediately rather than a placeholder that resolves on a refetch.
   */
  const [justUploaded, setJustUploaded] = useState<Upload[]>([]);

  // `attached: false` — the pane's job is the images nothing is using yet,
  // which is also exactly the set that counts against the pending limit.
  const gallery = useUploads({
    purpose,
    attached: false,
    limit: GALLERY_LIMIT,
  });
  const create = useCreateUpload();
  const remove = useDeleteUpload();

  const items = gallery.data?.items ?? [];
  const full = value.length >= max;

  const thumbs = new Map<string, KnownImage>();
  for (const item of items) {
    thumbs.set(item.id, {
      uploadId: item.id,
      url: item.url,
      thumbUrl: item.thumbUrl,
    });
  }
  for (const upload of justUploaded) {
    thumbs.set(upload.id, {
      uploadId: upload.id,
      url: upload.url,
      thumbUrl: upload.thumbUrl,
    });
  }
  for (const image of known ?? []) thumbs.set(image.uploadId, image);

  /**
   * A 503 means the server has no S3 keys at all — the normal state on a
   * development machine, where `getStorage()` returns null. It is an
   * explanation, not a failure: the rest of the form still works, and nobody
   * can do anything about it from here.
   */
  const storageUnavailable =
    gallery.error?.code === API_ERROR_CODE.STORAGE_NOT_CONFIGURED ||
    create.error?.code === API_ERROR_CODE.STORAGE_NOT_CONFIGURED;

  const select = (id: ObjectId) => {
    if (value.includes(id) || value.length >= max) return;
    onChange([...value, id]);
  };

  const unselect = (id: ObjectId) => {
    onChange(value.filter((current) => current !== id));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  /**
   * One file per request — `multer.single("file")` accepts exactly one, and
   * React Query's per-call `onSuccess` belongs to the *latest* `mutate` on a
   * mutation instance, so firing several at once would drop the ids of all but
   * the last. Extra files are reported rather than silently ignored.
   */
  const upload = (files: File[]) => {
    if (disabled || files.length === 0) return;

    if (full) {
      setIssue(`You already have ${max} images. Remove one to add another.`);
      return;
    }

    const [file, ...rest] = files;
    if (!file) return;

    const refusal = refuseLocally(file);
    if (refusal) {
      setIssue(refusal);
      return;
    }

    setIssue(
      rest.length > 0
        ? `Adding ${file.name}. Images go up one at a time, so add the other ${rest.length} after it.`
        : null,
    );

    create.mutate(
      { file, purpose },
      {
        onSuccess: (created) => {
          setJustUploaded((previous) => [...previous, created]);
          // Straight into the selection: the person picked this file in order
          // to use it, and "upload it, now also choose it" is a second step
          // nobody wants.
          if (value.length < max) onChange([...value, created.id]);
        },
      },
    );
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    // `accept` on the input does not apply to a dropped file, so this is the
    // path a HEIC actually arrives on. `refuseLocally` is what catches it.
    upload(Array.from(event.dataTransfer?.files ?? []));
  };

  const tile =
    "relative flex aspect-square items-center justify-center overflow-hidden rounded-[10px] border border-border bg-muted/40";

  const selectedTiles = value.map((id, index) => {
    const image = thumbs.get(id);
    return (
      <li key={id} className={tile}>
        {image ? (
          // A plain <img>, not `next/image`: the S3 host comes from
          // NEXT_PUBLIC_S3_HOSTNAME and `next.config.ts` leaves
          // `images.remotePatterns` empty when it is unset, which is every
          // development machine — `next/image` throws on an unconfigured host,
          // and this lane may not edit that config.
          // biome-ignore lint/performance/noImgElement: see above
          <img
            src={image.thumbUrl}
            alt={index === 0 ? "Main image" : `Image ${index + 1}`}
            className="size-full object-cover"
          />
        ) : (
          <span className="px-2 text-center text-[11px] text-muted-foreground">
            Image {index + 1}
          </span>
        )}

        {index === 0 ? (
          <span className="absolute top-1 left-1 rounded-md bg-background/90 px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
            Main
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 px-1 py-1">
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Move image ${index + 1} earlier`}
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Move image ${index + 1} later`}
              disabled={disabled || index === value.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove image ${index + 1}`}
            disabled={disabled}
            onClick={() => unselect(id)}
            className="text-muted-foreground hover:text-destructive"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </li>
    );
  });

  const addTile = (
    <li className={cn(tile, dragging && "border-primary bg-primary/5")}>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={disabled || create.isPending}
        onChange={(event) => {
          upload(Array.from(event.target.files ?? []));
          // Let the same file be chosen twice — after a failed upload the
          // second pick of the same file fires no change event otherwise.
          event.target.value = "";
        }}
      />
      <label
        htmlFor={inputId}
        className="flex size-full cursor-pointer flex-col items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ImagePlus className="size-5" aria-hidden="true" />
        {create.isPending ? "Uploading" : "Add image"}
      </label>
    </li>
  );

  const galleryPane = (): ReactNode => {
    if (gallery.isPending) {
      return (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <li key={key}>
              <Skeleton className="aspect-square w-full rounded-[10px]" />
            </li>
          ))}
        </ul>
      );
    }

    if (gallery.error) {
      // A 403 is a role without `uploads:create` — the same permission the
      // gallery is gated on. A calm absence, not something to retry.
      if (gallery.error.status === 403) {
        return (
          <p className="text-[12px] text-muted-foreground">
            Your role cannot upload images.
          </p>
        );
      }
      return (
        <ErrorCard
          error={gallery.error}
          retry={() => void gallery.refetch()}
          title="Couldn't load your recent uploads"
        />
      );
    }

    if (items.length === 0) {
      return (
        <p className="text-[12px] text-muted-foreground">
          Images you upload appear here until something uses them.
        </p>
      );
    }

    return (
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {items.map((item, index) => {
          const chosen = value.includes(item.id);
          const deleting = remove.isPending && remove.variables === item.id;
          return (
            <li key={item.id} className={cn(tile, chosen && "border-primary")}>
              {/* biome-ignore lint/performance/noImgElement: see the selected tiles above */}
              <img
                src={item.thumbUrl}
                alt=""
                className="size-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 px-1 py-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={
                    chosen
                      ? `Unselect image ${index + 1}`
                      : `Use image ${index + 1}`
                  }
                  disabled={disabled || (!chosen && full)}
                  onClick={() => (chosen ? unselect(item.id) : select(item.id))}
                  className="h-6 px-1.5 text-[11px]"
                >
                  {chosen ? "Selected" : "Use"}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete image ${index + 1} permanently`}
                  disabled={disabled || deleting}
                  onClick={() =>
                    remove.mutate(item.id, {
                      // Deleting one that is currently chosen has to leave the
                      // form's ids honest, or it submits an id that is gone.
                      onSuccess: () => unselect(item.id),
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  const refusal = create.error ? uploadRefusal(create.error) : null;
  const deleteRefusal =
    remove.error?.code === API_ERROR_CODE.UPLOAD_ATTACHED
      ? "That image is in use somewhere else. Remove it there before deleting it."
      : (remove.error?.message ?? null);

  return (
    <fieldset
      aria-label="Images"
      className={cn("flex flex-col gap-3", className)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-[13px] text-foreground">Images</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {value.length} of {max}
        </span>
      </div>

      {/* Rendered whatever the storage says. Images already saved on a product
          stay visible, removable and reorderable even when the server has lost
          its S3 configuration — only *adding* one is impossible then. */}
      {value.length > 0 || !storageUnavailable ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {selectedTiles}
          {full || storageUnavailable ? null : addTile}
        </ul>
      ) : null}

      {storageUnavailable ? (
        <div className="rounded-[10px] border border-border bg-card">
          <EmptyState
            icon={ImageOff}
            title="Image uploads are not set up"
            description="This server has no image storage configured, so pictures can't be added yet. Everything else on this form works — whoever runs the server can turn it on."
          />
        </div>
      ) : (
        <>
          {issue ? (
            <p className="text-[12px] text-destructive">{issue}</p>
          ) : null}
          {refusal ? (
            <p className="text-[12px] text-warning-strong">
              {refusal}
              {create.error?.requestId ? (
                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                  Request ID: {create.error.requestId}
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 border-border/60 border-t pt-3">
            <span className="font-medium text-[12px] text-muted-foreground">
              Your recent uploads
            </span>
            {galleryPane()}
            {deleteRefusal ? (
              <p className="text-[12px] text-warning-strong">{deleteRefusal}</p>
            ) : null}
          </div>
        </>
      )}
    </fieldset>
  );
}
