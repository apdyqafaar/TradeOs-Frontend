"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { useDeleteProduct } from "@/features/products/hooks/use-product-mutations";
import type { Product } from "@/features/products/types";
import { API_ERROR_CODE, type ApiError, hasCode } from "@/lib/api/errors";

/**
 * How many sales refused the delete, when the server said so.
 *
 * `details.saleCount` is a number on the wire, but `details` is an unknown bag
 * — it is whatever the server put there — so it is checked rather than cast.
 * A refusal that arrives without the count is still a refusal worth showing;
 * the caller falls back to prose that does not cite a number it does not have.
 *
 * Exported for its test: the fallback is the branch that only runs when the
 * backend changes shape, which is exactly when nobody is looking.
 */
export function saleCountOf(error: ApiError): number | null {
  if (!hasCode(error, API_ERROR_CODE.PRODUCT_HAS_SALES)) return null;

  const count = (error.details as { saleCount?: unknown } | undefined)
    ?.saleCount;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

/** "1 sale" / "4 sales" — the number the decision is actually made on. */
const sales = (count: number) => `${count} ${count === 1 ? "sale" : "sales"}`;

/**
 * Permanently deleting a product — the destructive twin of Archive.
 *
 * Two controls that both remove a product from the list need to be told apart
 * before either is pressed, so this dialog leads with what does **not** come
 * back and Archive's leads with what does. The two also fail differently:
 * archiving always works, and this refuses outright once the product has been
 * sold.
 *
 * **The refusal is shown here, not toasted.** It carries a number — how many
 * sales stand in the way — and that number is the reason the answer is no; a
 * toast would float it away from the button that earned it. The same call
 * `features/categories` makes for `CATEGORY_IN_USE`.
 *
 * On success the caller is sent back to the list, because the page it is
 * standing on now describes a product that does not exist.
 */
export function DeleteProductDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const remove = useDeleteProduct();
  const [failure, setFailure] = useState<ApiError | null>(null);

  const refusedCount = failure ? saleCountOf(failure) : null;
  const refused = failure
    ? hasCode(failure, API_ERROR_CODE.PRODUCT_HAS_SALES)
    : false;

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
          <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
            Delete {product.name}?
          </Dialog.Title>

          <Dialog.Description
            render={<div />}
            className="flex flex-col gap-2 text-[13px] text-muted-foreground leading-relaxed"
          >
            <span>
              This removes the product and every stock movement recorded against
              it. It cannot be undone.
            </span>
            <span>
              If you only want it off the counter, use Archive instead — an
              archived product keeps its stock, its prices and its history, and
              can be restored.
            </span>
          </Dialog.Description>

          {failure ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/30 bg-destructive-soft px-3.5 py-2.5 text-[13px] text-destructive-strong leading-relaxed"
            >
              {refused ? (
                <>
                  {refusedCount === null
                    ? "This product has already been sold, so it cannot be deleted."
                    : `This product has been sold in ${sales(refusedCount)}, so it cannot be deleted.`}{" "}
                  Deleting it would leave those receipts citing a product with
                  no record behind it. Archive it instead.
                </>
              ) : (
                failure.message
              )}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              {refused ? "Close" : "Cancel"}
            </Button>

            {/* Gone once the answer is a standing no: the same press cannot
                succeed a second time, and offering it invites the reader to
                keep trying instead of reading why. */}
            {refused ? null : (
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                className="h-10 rounded-[10px] px-4 text-[13px]"
                onClick={() => {
                  setFailure(null);
                  remove.mutate(product.id, {
                    onSuccess: () => {
                      onOpenChange(false);
                      router.push(ROUTES.products);
                    },
                    onError: (error: ApiError) => setFailure(error),
                  });
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
