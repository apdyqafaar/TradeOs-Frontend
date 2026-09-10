"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api/errors";
import { API_ERROR_CODE } from "@/lib/api/errors";
import { useDeleteAnnouncement } from "../hooks/use-announcement-mutations";
import type { Announcement } from "../types";

export interface DeleteAnnouncementDialogProps {
  announcement: Announcement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the row is gone. The reading screen navigates back to the feed. */
  onDeleted?: () => void;
}

/**
 * The last screen before an irreversible write.
 *
 * `DELETE /announcements/:id` is a hard `findOneAndDelete` — no soft-delete
 * flag, no removed status, no restore path (`announcement.actions.ts:126-131`,
 * proven by `announcements.test.ts:166-182`: delete then get is a 404) — and if
 * the notice has a cover, the image is released from storage once the
 * transaction commits, so it goes too. Both facts are in the copy, because
 * "Are you sure?" is not information.
 *
 * It answers **204 with no body**, which is why `useDeleteAnnouncement` is
 * typed `Promise<void>` and why this dialog reports success by calling
 * `onDeleted` rather than by reading anything back.
 *
 * A 404 here means somebody else deleted it first. That is the outcome this
 * dialog wanted, so it is not shown as a failure — it closes and reports done,
 * and the feed's invalidation takes the row off the screen.
 *
 * `@base-ui/react`, and `render` rather than `asChild` — this repo's shadcn
 * build is base-nova (CLAUDE.md).
 */
export function DeleteAnnouncementDialog({
  announcement,
  open,
  onOpenChange,
  onDeleted,
}: DeleteAnnouncementDialogProps) {
  const remove = useDeleteAnnouncement();
  const [issue, setIssue] = useState<string | null>(null);

  const close = () => {
    setIssue(null);
    onOpenChange(false);
  };

  const done = () => {
    setIssue(null);
    onOpenChange(false);
    onDeleted?.();
  };

  const submit = () => {
    setIssue(null);
    remove.mutate(announcement.id, {
      onSuccess: done,
      onError: (error: ApiError) => {
        // Already gone is the result this dialog was asking for. Branching on
        // `code`, never on `message` (CLAUDE.md).
        if (error.code === API_ERROR_CODE.NOT_FOUND) {
          done();
          return;
        }
        setIssue(error.message);
      },
    });
  };

  const busy = remove.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
            {/* The notice's own title is the question — a generic "Delete this
                announcement?" makes the wrong row easy to delete from a feed of
                several. */}
            Delete “{announcement.title}”?
          </Dialog.Title>

          <Dialog.Description className="text-[13px] text-muted-foreground">
            It disappears for everyone in this business straight away, and it
            cannot be brought back.
            {announcement.cover
              ? " The cover image is deleted from storage with it."
              : ""}
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
              onClick={close}
              className="h-10 rounded-[10px] px-4 text-[13px]"
            >
              Cancel
            </Button>
            {/*
              The solid destructive fill, not the vendored soft tint: that
              variant is for reversible destructive actions and this one is not.
              Tokens, never the hex.
            */}
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={submit}
              className="h-10 rounded-[10px] bg-destructive px-4 font-semibold text-[13px] text-destructive-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
