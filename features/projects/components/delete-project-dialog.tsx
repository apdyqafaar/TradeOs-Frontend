"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import { useDeleteProject } from "../hooks/use-project-mutations";
import { forgetShareToken } from "../share-token-store";
import type { Project } from "../types";

export interface DeleteProjectDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the row is gone. The detail screen navigates back to the grid. */
  onDeleted?: () => void;
}

/**
 * The last screen before an irreversible write.
 *
 * `DELETE /projects/:id` is a hard delete that **cascades**: the project's
 * every progress note is removed in the same transaction
 * (`project.service.ts:215-239`, proven by `projects.test.ts:195-215` —
 * `countDocuments === 0` afterwards), and the cover image is released from
 * storage once it commits. There is no soft-delete flag and no restore path.
 * All three facts are in the copy, because "Are you sure?" is not information.
 *
 * The one thing it does *not* claim: that deleting revokes what the client
 * already has. The public page goes down with the project, but the cover and
 * logo URLs are on a public-read bucket with no signed URLs
 * (`storage.ts:27-28`, `FINDINGS` §3), so an image anyone already saved keeps
 * resolving. Rather than say something reassuring and untrue, the dialog says
 * nothing about it — the share card is where that distinction is drawn.
 *
 * It answers **204 with no body**, which is why `useDeleteProject` is typed
 * `Promise<void>` and why this dialog reports success by calling `onDeleted`
 * rather than by reading anything back.
 *
 * A 404 here means somebody else deleted it first. That is the outcome this
 * dialog wanted, so it is not shown as a failure.
 *
 * `@base-ui/react`, and `render` rather than `asChild` — this repo's shadcn
 * build is base-nova (CLAUDE.md).
 */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: DeleteProjectDialogProps) {
  const remove = useDeleteProject();
  const [issue, setIssue] = useState<string | null>(null);

  const close = () => {
    setIssue(null);
    onOpenChange(false);
  };

  const done = () => {
    // The link is dead with the project, so the token this tab was holding is
    // not just useless, it is a URL that would 404 if anyone copied it.
    forgetShareToken(project.id);
    setIssue(null);
    onOpenChange(false);
    onDeleted?.();
  };

  const submit = () => {
    setIssue(null);
    remove.mutate(project.id, {
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
            {/* The project's own title is the question — a generic "Delete this
                project?" makes the wrong one easy to delete from a grid of
                several. */}
            Delete “{project.title}”?
          </Dialog.Title>

          <Dialog.Description
            render={<div />}
            className="flex flex-col gap-2 text-[13px] text-muted-foreground"
          >
            <span>
              Every update posted against it goes too, and none of it can be
              brought back.
            </span>
            {project.isPublished ? (
              <span>The client's shared page stops working immediately.</span>
            ) : null}
            {project.cover ? (
              <span>The cover image is deleted from storage with it.</span>
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
