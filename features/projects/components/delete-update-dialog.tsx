"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { useDeleteProjectUpdate } from "../hooks/use-project-mutations";
import type { ProjectUpdate } from "../types";

export interface DeleteUpdateDialogProps {
  update: ProjectUpdate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/**
 * The confirmation in front of deleting one progress note.
 *
 * Two facts in the copy, both of which a user would otherwise get wrong:
 *
 *   1. **The client sees it disappear immediately.** The public page is a live
 *      query with no cache (`project-update.actions.ts:69-73`), so a note
 *      deleted here is gone from the shared page on their next refresh.
 *   2. **The project's progress does NOT go back.** Nothing recomputes it — the
 *      delete path has no progress logic at all
 *      (`project.service.ts:305-315`) — so a note that moved the project to 40%
 *      leaves it at 40% after being deleted. This is the reason there is no
 *      "undo" offered here: it would silently lie (contract trap 3).
 *
 * A 404 means somebody else deleted it first. That is the outcome this dialog
 * wanted, so it is not shown as a failure — it closes and reports done.
 *
 * `@base-ui/react`, and `render` rather than `asChild` — this repo's shadcn
 * build is base-nova (CLAUDE.md).
 */
export function DeleteUpdateDialog({
  update,
  open,
  onOpenChange,
  onDeleted,
}: DeleteUpdateDialogProps) {
  const remove = useDeleteProjectUpdate();
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
    remove.mutate(
      { projectId: update.projectId, updateId: update.id },
      {
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
      },
    );
  };

  const busy = remove.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] flex-col gap-4 overflow-y-auto rounded-[14px] border border-border bg-popover p-6 text-popover-foreground shadow-[0_12px_32px_rgba(31,30,29,0.14)] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-serif text-2xl text-foreground leading-tight">
            Delete this update?
          </Dialog.Title>

          <Dialog.Description
            render={<div />}
            className="flex flex-col gap-2 text-[13px] text-muted-foreground"
          >
            <span>
              It disappears from the client's shared page straight away, and it
              cannot be brought back.
            </span>
            {update.progress !== null ? (
              <span>
                The project stays at {update.progress}% — deleting an update
                does not move the progress back.
              </span>
            ) : null}
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
