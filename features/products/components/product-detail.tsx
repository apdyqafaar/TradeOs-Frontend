"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { ChevronLeft, ImageOff, PackageX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/shared/button-link";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorCard } from "@/components/shared/error-card";
import { ForbiddenScreen } from "@/components/shared/forbidden-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/config/routes";
import { useCan } from "@/features/auth/hooks/use-permission";
import { useOrganization } from "@/features/organization/hooks/use-organization";
import { ProductForm } from "@/features/products/components/product-form";
import { StockCard } from "@/features/products/components/stock-card";
import { StockMovementsTable } from "@/features/products/components/stock-movements-table";
import { useProduct } from "@/features/products/hooks/use-product";
import {
  useArchiveProduct,
  useUpdateProduct,
} from "@/features/products/hooks/use-product-mutations";
import type { Product, ProductImage } from "@/features/products/types";
import type { ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/format/money";

/**
 * Gross margin, the way artboard `2d` reads it: what share of the price the
 * business keeps.
 *
 * `(selling - cost) / selling`, **not** `(selling - cost) / cost`. The second is
 * markup; it is a bigger number for the same two prices (36.3% against 26.6%
 * for 9.10 and 12.40), and a card that showed it under the word "Margin" would
 * flatter every product in the catalogue.
 *
 * A duplicate of the same function in `product-form.tsx`, which does not export
 * it. Kept in step deliberately: the form previews this figure while it is
 * being typed and this card reports it once it is saved, and the two showing
 * different percentages for one product is the failure worth avoiding.
 */
const marginPercent = (cost: number, selling: number): number | null => {
  if (!Number.isFinite(cost) || !Number.isFinite(selling) || selling <= 0) {
    return null;
  }
  return ((selling - cost) / selling) * 100;
};

interface ProductDetailProps {
  id: ObjectId;
}

/**
 * One product, everything about it — artboard `2d`, the plan's Task 7.
 *
 * The screen is a read view with two things layered on it: the Task 6 form,
 * mounted in place when Edit is pressed (that is what `ProductForm`'s
 * `onSaved` callback exists for), and a confirm dialog for Archive.
 *
 * **The one rule the layout encodes: an untracked product has no stock.** No
 * stock card, no movements table, no zeroes — `trackStock: false` is a service
 * or a fee, and `POST /products/:id/stock` refuses one with 409
 * `STOCK_NOT_TRACKED`. A muted line says so once, where the card would be.
 */
export function ProductDetail({ id }: ProductDetailProps) {
  const { data: product, error, isPending, refetch } = useProduct(id);
  const { currency, isLoading: organizationLoading } = useOrganization();
  const canUpdate = useCan(PERMISSIONS.PRODUCTS_UPDATE);
  const canArchive = useCan(PERMISSIONS.PRODUCTS_DELETE);

  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // A 403 is not a failure to retry: nothing broke, the caller simply may not
  // read this. `ROUTE_PERMISSIONS` resolves `/products/<id>` to `products:view`
  // through its `/products` parent, so arriving here means a custom role lost
  // it between renders.
  if (error?.status === 403) return <ForbiddenScreen />;

  if (error?.status === 404) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        {/*
          404 covers "no such product" and "it belongs to another business" —
          the API answers the same for both so an id cannot be probed for
          existence. Neither is an error worth a red panel or a request id.
        */}
        <EmptyState
          title="This product isn't here"
          description="It may have been removed, or the link may point at another business."
          icon={PackageX}
          action={
            <ButtonLink variant="outline" href={ROUTES.products}>
              Back to products
            </ButtonLink>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <ErrorCard
          error={error}
          retry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (isPending || !product) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <Skeleton className="h-9 w-[280px]" />
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <Skeleton className="h-[220px] rounded-[10px]" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[86px] rounded-[10px]" />
            <Skeleton className="h-[104px] rounded-[10px]" />
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-5">
        <BackLink />
        <h1 className="font-serif text-[32px] leading-[1.1] text-foreground">
          Edit {product.name}
        </h1>
        {/*
          The same component `/products/new` renders, in edit mode. `onSaved`
          returns to the read view rather than navigating, so the person lands
          back on the product they just changed with the new values already in
          the cache — `useUpdateProduct` seeds `productKeys.detail(id)` from the
          response.
        */}
        <ProductForm
          mode="edit"
          product={product}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const margin = marginPercent(product.costPrice, product.sellingPrice);
  const subtitle = [product.barcode, product.category?.name, product.unit]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[30px] leading-[1.1] text-foreground">
              {product.name}
            </h1>
            {product.status === "archived" ? (
              <span className="inline-flex h-[22px] items-center rounded-lg bg-muted px-2 font-medium text-[11px] text-muted-foreground">
                Archived
              </span>
            ) : null}
          </div>
          <span className="font-mono text-[12px] text-muted-foreground">
            {subtitle}
          </span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {canUpdate ? (
            <Button
              variant="outline"
              className="h-[38px] rounded-[10px] px-3.5 text-[13px]"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          ) : null}

          {/*
            "Archive", never "Delete" (brief §9) — `DELETE /products/:id` sets
            `status: "archived"` and the product goes on existing. The control
            is absent once it is archived, and a Restore takes its place.
          */}
          {canArchive && product.status === "active" ? (
            <Button
              variant="outline"
              className="h-[38px] rounded-[10px] px-3.5 text-[13px] text-muted-foreground"
              onClick={() => setConfirmingArchive(true)}
            >
              Archive
            </Button>
          ) : null}

          {canUpdate && product.status === "archived" ? (
            <RestoreButton product={product} />
          ) : null}
        </div>
      </header>

      {product.status === "archived" ? (
        <p className="rounded-[10px] border border-border bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          Archived — this product cannot be sold, scanned at the counter, or
          restocked. Restoring it puts it back on the list with its stock
          untouched.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <ProductGallery images={product.images} name={product.name} />

        <div className="flex flex-col gap-4">
          <section className="grid gap-[18px] rounded-[10px] border border-border bg-card p-[18px] sm:grid-cols-3">
            <Figure
              label="Cost price"
              value={formatMoney(product.costPrice, currency).trim()}
              loading={organizationLoading}
            />
            <Figure
              label="Selling price"
              value={formatMoney(product.sellingPrice, currency).trim()}
              loading={organizationLoading}
            />
            <Figure
              label="Margin"
              // Not a money figure, so it needs no currency and does not wait
              // for one. Negative — selling under cost — is worth seeing in red
              // rather than as a minus sign in a column of green.
              value={margin === null ? "—" : `${margin.toFixed(1)}%`}
              className={
                margin === null
                  ? undefined
                  : margin < 0
                    ? "text-destructive-strong"
                    : "text-success-strong"
              }
            />
          </section>

          {product.trackStock ? (
            <StockCard product={product} />
          ) : (
            <p className="rounded-[10px] border border-border bg-card p-[18px] text-[13px] text-muted-foreground">
              Stock is not tracked for this product — it is a service or a fee,
              so there is no quantity to restock, adjust or run out of.
            </p>
          )}

          {product.description ? (
            <section className="rounded-[10px] border border-border bg-card px-[18px] py-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Description
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground text-pretty">
                {product.description}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      {/*
        Absent, not empty, for an untracked product: the endpoint would answer
        with an empty page and the table would read as "nothing has happened
        yet" rather than "this cannot happen".
      */}
      {product.trackStock ? (
        <StockMovementsTable productId={product.id} unit={product.unit} />
      ) : null}

      <ArchiveDialog
        product={product}
        open={confirmingArchive}
        onOpenChange={setConfirmingArchive}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href={ROUTES.products}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Products
    </Link>
  );
}

/** One cell of the pricing card: a mono caption over a mono figure. */
function Figure({
  label,
  value,
  className,
  loading = false,
}: {
  label: string;
  value: string;
  className?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {loading ? (
        // The currency code is part of the figure, so an amount must not land
        // before it does — a bare `9.10` that gains a `USD` a beat later reads
        // as a bug.
        <Skeleton className="h-[22px] w-[7ch]" />
      ) : (
        <span
          className={cn("font-mono text-[18px] text-foreground", className)}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * The canvas's left column: a main shot with a strip of thumbnails.
 *
 * Plain `<img>`, not `next/image`, for the reason spelled out in
 * `product-table.tsx`: the S3 host comes from `NEXT_PUBLIC_S3_HOSTNAME`,
 * `next.config.ts` leaves `images.remotePatterns` empty when that is unset —
 * which is every development machine — and `next/image` throws on an
 * unconfigured host.
 *
 * The canvas also draws a dashed `+` tile at the end of the strip. There is no
 * upload flow on this screen: images are attached through `<ImagePicker>` inside
 * the product form, and a tile here would either open a second picker whose
 * saves nothing commits or do nothing at all. Edit is the way in.
 */
function ProductGallery({
  images,
  name,
}: {
  images: ProductImage[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  const main = images[active] ?? images[0];

  if (!main) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-[10px] border border-border bg-muted text-muted-foreground">
        <ImageOff className="size-5" aria-hidden="true" />
        <span className="text-[12px]">No photo</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* biome-ignore lint/performance/noImgElement: see the note above */}
      <img
        src={main.url}
        alt={name}
        className="h-[220px] w-full rounded-[10px] border border-border bg-muted object-cover"
      />

      {images.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={image.uploadId}
              type="button"
              aria-label={`Show image ${index + 1} of ${images.length}`}
              aria-pressed={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "size-14 overflow-hidden rounded-lg border bg-muted transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                index === active ? "border-primary" : "border-border",
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: see the note above */}
              <img
                src={image.thumbUrl}
                alt=""
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Un-archive. `PATCH /products/:id` accepts `status: "active"` and nothing
 * else — archiving is the DELETE — so this is the only way back.
 *
 * Not in the plan and not on the canvas, which draws only the Archive side.
 * Added because "archiving is not deleting" (brief §9) is only true if the
 * product can come back, and without this the archived filter on the list is a
 * one-way door. Recorded in `docs/findings/s2-task-07.md`.
 */
function RestoreButton({ product }: { product: Product }) {
  const update = useUpdateProduct();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={update.isPending}
        className="h-[38px] rounded-[10px] px-3.5 text-[13px]"
        onClick={() => {
          setFailure(null);
          update.mutate(
            { id: product.id, input: { status: "active" } },
            { onError: (error: ApiError) => setFailure(error.message) },
          );
        }}
      >
        {update.isPending ? "Restoring…" : "Restore"}
      </Button>
      {failure ? (
        <span className="text-[12px] text-destructive">{failure}</span>
      ) : null}
    </div>
  );
}

/**
 * The Archive confirmation.
 *
 * A dialog rather than an immediate call because the button sits beside Edit
 * and a mis-click takes the product off every list the shop uses. The copy says
 * what archiving actually does, since the word does not carry it on its own.
 *
 * A refusal is shown **inside the dialog**, where the action was taken (brief
 * §8.4), rather than as a toast that outlives it.
 */
function ArchiveDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const archive = useArchiveProduct();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailure(null);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[440px] flex-col gap-4 rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl leading-tight text-foreground">
            Archive {product.name}?
          </Dialog.Title>
          <Dialog.Description className="text-[13px] leading-relaxed text-muted-foreground">
            It leaves the products list and the counter can no longer scan or
            sell it. Its stock, its price and every movement recorded against it
            stay exactly as they are, and you can restore it from the Archived
            filter.
          </Dialog.Description>

          {failure ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong"
            >
              {failure}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={archive.isPending}
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={archive.isPending}
              className="h-10 rounded-[10px] px-4 text-[13px]"
              onClick={() => {
                setFailure(null);
                archive.mutate(product.id, {
                  onSuccess: () => onOpenChange(false),
                  onError: (error: ApiError) => setFailure(error.message),
                });
              }}
            >
              {archive.isPending ? "Archiving…" : "Archive"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
