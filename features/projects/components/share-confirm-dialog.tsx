"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface ShareConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** The word on the button that does it. "Regenerate", "Unpublish". */
  confirmLabel: string;
  /** While the mutation is in flight. */
  busy?: boolean;
  /** A refusal from the last attempt, shown in place rather than as a toast. */
  issue?: string | null;
  onConfirm: () => void;
}

/**
 * The confirmation in front of the two share actions that cost something.
 *
 * Both of them break a link somebody may already be holding, and neither is
 * undoable in the way a user would expect:
 *
 *   - **Regenerate** overwrites the token hash, so **every link already given
 *     to a client stops working immediately** (`project.service.ts:362-364`,
 *     proven `public-link.test.ts:141-166`). It is also the only way to recover
 *     a link this browser can no longer show, which is exactly why it needs a
 *     wall in front of it — it is reached most often by someone who has *lost*
 *     something, and who is therefore not reading carefully.
 *   - **Unpublish** takes the public page down instantly (the public query
 *     filters on `isPublished: true`, with no cache and no grace period) and,
 *     though publishing again restores the very same link, that re-publish
 *     answers `shareToken: null` — so the URL keeps working while becoming
 *     impossible to display again. That is surprising enough to be worth
 *     saying before the click rather than after.
 *
 * One component for both because the shape is identical and the difference is
 * words. `@base-ui/react`, and `render` rather than `asChild` — this repo's
 * shadcn build is base-nova (CLAUDE.md).
 */
export function ShareConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy,
  issue,
  onConfirm,
}: ShareConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
            {title}
          </Dialog.Title>

          <Dialog.Description
            // `render` on a div, not the default `<p>`: the descriptions here
            // are two sentences with different weights and one of them wraps a
            // second block.
            render={<div />}
            className="flex flex-col gap-2 text-[13px] text-muted-foreground"
          >
            {description}
          </Dialog.Description>

          {issue ? (
            <p
              role="alert"
              className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3.5 py-3 text-[13px] text-destructive-strong"
            >
              {issue}
            </p>
          ) : null}

          <div className="flex justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
